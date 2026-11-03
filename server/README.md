# Backend — not built yet

This folder is a placeholder for the production backend. The development server
in `tools/serve.ps1` (and its Node twin `tools/serve.js`) already does the whole
job; it is just not something to run as a service on an internal server.

Whatever replaces it must reproduce the four routes exactly as specified in the
**Endpoint contract** section of the top-level `README.md`:

| Route | Job |
|---|---|
| `GET /` and everything under it | serve `public/` as static files |
| `GET /api/issues` | forward to Jira, add the credentials server-side, return Jira's body and status unchanged, honour `nextPageToken` |
| `GET /api/reference` | read `dane/inicjatywy.xlsm`, return the strategic matrix plus `uploadedAt`, `uploadedBy`, `canUpload` |
| `POST /api/reference` | accept the uploaded workbook as raw bytes, validate it, **parse before replacing**, then write `dane/inicjatywy.xlsm` and `dane/inicjatywy.meta.json` |
| `GET /api/valuation` | read `dane/wartosc_biznesowa.xlsx`, return per-year EBITDA and the project category |

Three things in that contract are easy to get wrong and are worth reading before
writing any code:

- the upload must be rejected **without touching** the previous workbook — see
  *Verifying a change* for the test that proves it;
- both workbooks are read through a temporary copy, because Excel holds the
  original open with a share mode that blocks a plain read;
- `Content-Type` on the upload is `application/octet-stream`, not multipart.

Credentials: with `CFG.auth = 'server'` the Jira token belongs to a technical
user and comes from an environment variable or the Windows credential store,
never from a file in the repository. See *Authentication* and *Deployment* in
the top-level `README.md`; step 3 there shows how the token reaches the service.
