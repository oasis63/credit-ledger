package tally

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const sample = `<ENVELOPE><BODY><DATA><COLLECTION>
<LEDGER NAME="Gupta Medical Store"><CLOSINGBALANCE>-55,000.00</CLOSINGBALANCE><LEDGERMOBILE>9876543210</LEDGERMOBILE><PARTYGSTIN>09AAACG1234A1Z5</PARTYGSTIN></LEDGER>
<LEDGER NAME="Advance Paid Chemist"><CLOSINGBALANCE>1200.50</CLOSINGBALANCE><LEDGERPHONE>0512-222333</LEDGERPHONE></LEDGER>
<LEDGER NAME="Zero &amp; Co"><CLOSINGBALANCE></CLOSINGBALANCE></LEDGER>
</COLLECTION></DATA></BODY></ENVELOPE>`

func TestParseLedgers(t *testing.T) {
	got, err := ParseLedgers([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 ledgers, got %d", len(got))
	}
	if got[0].Name != "Gupta Medical Store" || got[0].ClosingBalancePaise != 5_500_000 || got[0].Phone != "9876543210" || got[0].GSTIN != "09AAACG1234A1Z5" {
		t.Errorf("unexpected first ledger: %+v", got[0])
	}
	if got[1].ClosingBalancePaise != -120_050 || got[1].Phone != "0512-222333" {
		t.Errorf("advance ledger should be negative (we owe them): %+v", got[1])
	}
	if got[2].Name != "Zero & Co" || got[2].ClosingBalancePaise != 0 {
		t.Errorf("unexpected zero ledger: %+v", got[2])
	}
}

func TestParseAmount(t *testing.T) {
	cases := map[string]int64{
		"-1,23,456.50": -12_345_650,
		"1234.00 Dr":   -123_400,
		"99 Cr":        9_900,
		"":             0,
	}
	for in, want := range cases {
		got, err := ParseAmount(in)
		if err != nil || got != want {
			t.Errorf("ParseAmount(%q) = %d, %v; want %d", in, got, err, want)
		}
	}
	if _, err := ParseAmount("abc"); err == nil {
		t.Error("expected error for invalid amount")
	}
}

func TestStripsControlCharacters(t *testing.T) {
	raw := strings.Replace(sample, "Gupta", "Gupta\x04", 1)
	got, err := ParseLedgers([]byte(raw))
	if err != nil || got[0].Name != "Gupta Medical Store" {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestFetchDebtorsAgainstFakeTally(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "$$GroupSundryDebtors") || !strings.Contains(string(body), "<SVCURRENTCOMPANY>Sharma &amp; Sons</SVCURRENTCOMPANY>") {
			t.Errorf("unexpected request body: %s", body)
		}
		_, _ = w.Write([]byte(sample))
	}))
	defer srv.Close()
	got, err := NewClient(srv.URL, "Sharma & Sons").FetchDebtors(context.Background())
	if err != nil || len(got) != 3 {
		t.Fatalf("got %d ledgers, err %v", len(got), err)
	}
}
