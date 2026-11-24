// Package tally reads debtor ledgers from TallyPrime over its XML-over-HTTP
// interface (Help > Settings > Advanced Configuration > HTTP Server, default
// port 9000). The agent is strictly read-only: it never posts to Tally.
package tally

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Ledger is one Sundry Debtors ledger with its closing balance.
type Ledger struct {
	Name                string `json:"name"`
	Phone               string `json:"phone,omitempty"`
	GSTIN               string `json:"gstin,omitempty"`
	ClosingBalancePaise int64  `json:"closing_balance_paise"` // positive = customer owes us
}

// ledgersRequest asks Tally for every ledger under Sundry Debtors (including
// sub-groups) with the fields we need. Uses an inline TDL collection, which
// works on TallyPrime and Tally.ERP 9.
const ledgersRequest = `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CLDebtorLedgers</ID></HEADER>
 <BODY><DESC>
  <STATICVARIABLES>%s<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
   <COLLECTION NAME="CLDebtorLedgers" ISMODIFY="No">
    <TYPE>Ledger</TYPE>
    <CHILDOF>$$GroupSundryDebtors</CHILDOF>
    <BELONGSTO>Yes</BELONGSTO>
    <FETCH>NAME, CLOSINGBALANCE, LEDGERMOBILE, LEDGERPHONE, PARTYGSTIN</FETCH>
   </COLLECTION>
  </TDLMESSAGE></TDL>
 </DESC></BODY>
</ENVELOPE>`

type envelope struct {
	Ledgers []xmlLedger `xml:"BODY>DATA>COLLECTION>LEDGER"`
}

type xmlLedger struct {
	NameAttr       string `xml:"NAME,attr"`
	Name           string `xml:"NAME"`
	ClosingBalance string `xml:"CLOSINGBALANCE"`
	Mobile         string `xml:"LEDGERMOBILE"`
	Phone          string `xml:"LEDGERPHONE"`
	GSTIN          string `xml:"PARTYGSTIN"`
}

// Client talks to one Tally instance.
type Client struct {
	URL     string // e.g. http://127.0.0.1:9000
	Company string // optional: which loaded company to read
	HTTP    *http.Client
}

func NewClient(url, company string) *Client {
	return &Client{URL: url, Company: company, HTTP: &http.Client{Timeout: 60 * time.Second}}
}

// FetchDebtors returns all debtor ledgers with balances.
func (c *Client) FetchDebtors(ctx context.Context) ([]Ledger, error) {
	company := ""
	if c.Company != "" {
		var b bytes.Buffer
		_ = xml.EscapeText(&b, []byte(c.Company))
		company = "<SVCURRENTCOMPANY>" + b.String() + "</SVCURRENTCOMPANY>"
	}
	body := fmt.Sprintf(ledgersRequest, company)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "text/xml; charset=utf-8")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cannot reach Tally at %s (is TallyPrime open with the HTTP server enabled and a company loaded?): %w", c.URL, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tally returned HTTP %d", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 200<<20))
	if err != nil {
		return nil, err
	}
	return ParseLedgers(raw)
}

// ParseLedgers decodes a Tally collection export. Tally may emit UTF-16 or
// control characters; we strip invalid XML characters before decoding.
func ParseLedgers(raw []byte) ([]Ledger, error) {
	clean := sanitize(raw)
	var env envelope
	dec := xml.NewDecoder(bytes.NewReader(clean))
	dec.Strict = false
	if err := dec.Decode(&env); err != nil {
		return nil, fmt.Errorf("parse tally response: %w", err)
	}
	out := make([]Ledger, 0, len(env.Ledgers))
	for _, l := range env.Ledgers {
		name := strings.TrimSpace(l.NameAttr)
		if name == "" {
			name = strings.TrimSpace(l.Name)
		}
		if name == "" {
			continue
		}
		bal, err := ParseAmount(l.ClosingBalance)
		if err != nil {
			return nil, fmt.Errorf("ledger %q: %w", name, err)
		}
		phone := strings.TrimSpace(l.Mobile)
		if phone == "" {
			phone = strings.TrimSpace(l.Phone)
		}
		out = append(out, Ledger{
			Name:  name,
			Phone: phone,
			GSTIN: strings.TrimSpace(l.GSTIN),
			// In Tally's XML, debit balances are negative. A debtor who owes
			// us has a debit balance, so flip the sign.
			ClosingBalancePaise: -bal,
		})
	}
	return out, nil
}

// ParseAmount converts Tally amount text ("-1,23,456.50", "1234.00 Dr") to
// signed paise using Tally's XML sign convention (debit negative).
func ParseAmount(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	sign := 1.0
	upper := strings.ToUpper(s)
	switch {
	case strings.HasSuffix(upper, "DR"):
		sign = -1
		s = strings.TrimSpace(s[:len(s)-2])
	case strings.HasSuffix(upper, "CR"):
		s = strings.TrimSpace(s[:len(s)-2])
	}
	s = strings.ReplaceAll(s, ",", "")
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid amount %q", s)
	}
	return int64(math.Round(v * sign * 100)), nil
}

func sanitize(b []byte) []byte {
	out := make([]byte, 0, len(b))
	for _, c := range b {
		if c < 0x20 && c != '\t' && c != '\n' && c != '\r' {
			continue
		}
		out = append(out, c)
	}
	return out
}
