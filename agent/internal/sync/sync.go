// Package sync pushes Tally ledger balances to the Credit Ledger API.
package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/credit-ledger/agent/internal/tally"
)

type Result struct {
	Updated     int      `json:"updated"`
	Created     int      `json:"created"`
	Skipped     int      `json:"skipped"`
	SkippedName []string `json:"skipped_names"`
}

type Pusher struct {
	APIURL string // e.g. https://ledger.example.in
	Key    string // clk_... agent key from Settings
	HTTP   *http.Client
}

func NewPusher(apiURL, key string) *Pusher {
	return &Pusher{APIURL: apiURL, Key: key, HTTP: &http.Client{Timeout: 120 * time.Second}}
}

// Push sends ledgers in batches. Connections are outbound only: the office PC
// never needs an open port.
func (p *Pusher) Push(ctx context.Context, ledgers []tally.Ledger) (Result, error) {
	const batch = 2000
	var total Result
	for start := 0; start < len(ledgers) || start == 0; start += batch {
		end := start + batch
		if end > len(ledgers) {
			end = len(ledgers)
		}
		r, err := p.pushBatch(ctx, ledgers[start:end])
		if err != nil {
			return total, err
		}
		total.Updated += r.Updated
		total.Created += r.Created
		total.Skipped += r.Skipped
		total.SkippedName = append(total.SkippedName, r.SkippedName...)
		if end == len(ledgers) {
			break
		}
	}
	return total, nil
}

func (p *Pusher) pushBatch(ctx context.Context, ledgers []tally.Ledger) (Result, error) {
	payload, err := json.Marshal(map[string]any{"ledgers": ledgers})
	if err != nil {
		return Result{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.APIURL+"/api/agent/sync/ledgers", bytes.NewReader(payload))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.Key)
	res, err := p.HTTP.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("cannot reach API: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		return Result{}, fmt.Errorf("API returned HTTP %d: %s", res.StatusCode, body)
	}
	var r Result
	if err := json.Unmarshal(body, &r); err != nil {
		return Result{}, fmt.Errorf("decode API response: %w", err)
	}
	return r, nil
}
