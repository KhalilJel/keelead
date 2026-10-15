# KeeLead Railway deployment

The image pins Atum246/keelead at `a846e2b6c19f781d44073f2e651c1ac8de52cf4a`
and installs the committed dependency lock, retaining Next 15.5.27.

`GET/POST /api/leads` runs only the audited DuckDuckGo Instant Answer, SearxNG,
and GitHub organization sources. Several other upstream sources construct example
or random contact data, so the old 67-source fan-out is intentionally excluded.
These are discovery candidates, not verified contacts or permission to send mail.
No public OSM/Nominatim service is used by this generic API.

Each query has a 20-second worker lifetime, six-second HTTP deadlines, 1 MiB
response limits, twelve requests per source and two concurrent workers per
process. The Linux process group is killed before releasing its admission slot.
Only complete results are cached (ten minutes, at most 100 queries). Count is
bounded to 1–50 and POST bodies to 16 KiB. `partial: true` means sources failed
or the requested count/deadline stopped the search early. A failed or timed-out
empty search returns 503, not a successful empty response. Busy searches return
429 with Retry-After. This endpoint uses no paid keys.

The supported deployment target is Linux (Railway). Windows unit tests skip the
Linux descendant-process assertion; CI exercises it on Ubuntu. The container
smoke check permits an explicit provider outage, but rejects worker startup
errors. A successful CI build alone does not prove live provider availability.

Startup runs the web server only. It never invokes Prisma db push, reset, or
accept-data-loss. Any database schema operation requires a separate reviewed
operation. Rollback must retain this startup restriction; the previous image
automatically invoked db push with accept-data-loss and is not a safe rollback.

Validate with `node --test tests/search.test.mjs` and `docker build .`.
Before merging/deploying, review the container build and actual search smoke
result. After deployment, verify health, a genuine bounded query, and Gullkornet's
integration check. Do not enable Gullkornet live-send as part of this change.
