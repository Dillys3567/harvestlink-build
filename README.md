# HarvestLink (BUILD version)

A marketplace where tomato farmers' upcoming harvests are shown to buyers, so buyers can say they would commit before harvest.
It is the test version for the XANIX Challenge BUILD stage. Setup steps are in `SETUP.md`.

- **Public site** (`index.html`): browse consented harvests, compare prices, send a request. English and draft Twi.
- **Coordinator** (`coordinator.html`): the team member who posts harvests for farmers, calls buyers, records answers and follow-ups, and exports the results.
- **Phone page**: a simulated basic phone (USSD menu, voice line, SMS) used to test whether farmers can post a harvest unaided. Attempts are logged.

The Twi is a first draft without a native speaker. Have a Twi speaker (ideally a farmer or trader from the field area) correct `i18n.js` before real users see it.
Add `?demo` to the address to see the sample-data version.

## Files
| File | What it holds |
|---|---|
| `index.html`, `styles.css` | Page structure and all colours and layout (change colours in the `:root` block) |
| `app.js` | All the behaviour: live and demo modes, browse, compare, requests, phone simulation |
| `i18n.js` | All the words, in English (`en`) and Twi (`tw`). Missing Twi lines show in English |
| `data.js` | Sample people and harvests, used only in the `?demo` version |
| `config.js`, `store.js` | Database connection |
| `schema.sql`, `schema-2.sql` | Database tables and access rules |
| `SETUP.md` | Step-by-step setup and practice run |

## Language
`i18n.js` holds every word. To fix a Twi line, find its key in the `tw` block and change the text; keep placeholders such as `{n}`, `{name}` and `{phone}` exactly as they are. The phone simulation is English only: keep every USSD screen under 160 characters (the phone screen shows the count).

## Phone simulation settings
`USSD_CODE`, `IVR_NUMBER` and `USSD_TIMEOUT_S` are at the top of the phone section in `app.js`. The short code and voice number are made up.
