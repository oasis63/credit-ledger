// Command agent runs on the distributor's office PC next to Tally. Every
// interval it reads Sundry Debtors balances from Tally (read-only) and pushes
// them to the Credit Ledger API over an outbound HTTPS connection.
//
// Configuration (environment variables):
//
//	CL_API_URL       Credit Ledger API base URL (required)
//	CL_AGENT_KEY     Agent key from Settings > Tally sync agent keys (required)
//	TALLY_URL        Tally HTTP server (default http://127.0.0.1:9000)
//	TALLY_COMPANY    Company name to read (default: the one currently loaded)
//	SYNC_INTERVAL    e.g. 15m (default 15m); use "once" to run a single sync
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/credit-ledger/agent/internal/sync"
	"github.com/credit-ledger/agent/internal/tally"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	apiURL := strings.TrimRight(os.Getenv("CL_API_URL"), "/")
	key := os.Getenv("CL_AGENT_KEY")
	if apiURL == "" || !strings.HasPrefix(key, "clk_") {
		log.Error("CL_API_URL and CL_AGENT_KEY (clk_...) are required")
		os.Exit(2)
	}
	tallyURL := envOr("TALLY_URL", "http://127.0.0.1:9000")
	intervalText := envOr("SYNC_INTERVAL", "15m")

	tc := tally.NewClient(tallyURL, os.Getenv("TALLY_COMPANY"))
	pusher := sync.NewPusher(apiURL, key)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if intervalText == "once" {
		if err := runOnce(ctx, log, tc, pusher); err != nil {
			os.Exit(1)
		}
		return
	}
	interval, err := time.ParseDuration(intervalText)
	if err != nil || interval < time.Minute {
		log.Error("SYNC_INTERVAL must be a duration of at least 1m, or 'once'", "value", intervalText)
		os.Exit(2)
	}

	log.Info("agent started", "tally", tallyURL, "api", apiURL, "interval", interval)
	backoff := time.Duration(0)
	for {
		err := runOnce(ctx, log, tc, pusher)
		wait := interval
		if err != nil {
			// Back off on repeated failures (Tally closed, network down), capped at the interval.
			backoff = min(interval, max(30*time.Second, backoff*2))
			wait = backoff
		} else {
			backoff = 0
		}
		select {
		case <-ctx.Done():
			log.Info("agent stopped")
			return
		case <-time.After(wait):
		}
	}
}

func runOnce(ctx context.Context, log *slog.Logger, tc *tally.Client, p *sync.Pusher) error {
	start := time.Now()
	ledgers, err := tc.FetchDebtors(ctx)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			log.Error("read from Tally failed", "err", err)
		}
		return err
	}
	res, err := p.Push(ctx, ledgers)
	if err != nil {
		log.Error("push to API failed", "err", err)
		return err
	}
	log.Info("sync complete", "ledgers", len(ledgers), "updated", res.Updated, "created", res.Created,
		"skipped_no_phone", res.Skipped, "took", time.Since(start).Round(time.Millisecond))
	return nil
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
