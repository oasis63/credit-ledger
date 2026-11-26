Put extra Caddy sites here as `*.caddy` files, for example `devnotes.caddy`:

    notes.example.com {
    	reverse_proxy host.docker.internal:4321
    }

Then run `docker compose restart caddy`.
