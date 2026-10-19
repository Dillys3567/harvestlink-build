# HarvestLink BUILD: setup

This folder is the whole test version: the public marketplace, the coordinator page, and the database rules.
It goes in your **new** GitHub repository (`harvestlink-build`). Do not touch the repository behind the ENTER submission.

## What is in this folder
| File | What it does |
|---|---|
| `index.html`, `app.js`, `styles.css`, `i18n.js`, `data.js` | The public marketplace and the phone simulation (English and draft Twi) |
| `coordinator.html` | The page the coordinator uses (sign-in needed) |
| `config.js` | Your Supabase address and publishable key (safe to be public) |
| `store.js` | Talks to the database. No install needed |
| `schema.sql`, `schema-2.sql` | Create the database tables and the rules about who can see what |

## Set up the database (about 20 minutes, once)
1. In Supabase, open **SQL Editor > New query**, paste all of `schema.sql`, click **Run**.
2. **Authentication > Users > Add user**. Enter the coordinator's email and a strong password. Tick **Auto Confirm User**.
3. **Authentication > Sign In / Providers**: turn **off** "Allow new users to sign up" (the name may differ slightly).
4. In **SQL Editor**, run this with the coordinator's real email. Repeat for any other coordinator:
   `insert into public.coordinators (user_id) select id from auth.users where email = 'coordinator@example.com';`
5. Open `coordinator.html` (hosted, or double-click it). Sign in. Add one practice farmer and one harvest.
6. Open `index.html`. The practice harvest should appear (the farmer must have consent ticked).
7. **Run `schema-2.sql`** the same way as step 1 (new query, paste, Run). This adds the buyer-request details and the phone-test log. Both files are safe to run again.
8. Do the full practice run below.

## Practice run (do this before anyone real is involved)
1. **Coordinator page:** add a farmer (tick consent), post a harvest for them, add a buyer, record an answer.
2. **Public page:** open the harvest, send a request with your own phone number and the consent box ticked. Check it appears under **Requests** on the coordinator page, with your number.
3. **Phone page:** type the farmer's code (for example F1) in the box, dial `*920*55#`, post a harvest. Check **Phone tests** shows one line, with the time and wrong keys. Click **Create listing**: the harvest should now appear on the public page.
4. **Twi:** switch the language and check the new buttons and messages appear.
5. **Wipe the practice data** (below) before the real test starts.

## Wipe practice data
Run in the SQL Editor:
`truncate public.phone_sessions, public.responses, public.follow_ups, public.enquiries, public.listings, public.buyers, public.farmer_private, public.farmers cascade;`
This keeps your coordinator login.

## How people use it (no accounts for farmers or buyers)
- **Farmers** tell the coordinator by phone or in person. The coordinator reads the consent text, ticks the box, and posts the harvest.
- **Buyers** can browse the public page and send a request with their phone number. The coordinator calls them back and records the answer.
- **Farmers on basic phones** can try the phone page while the coordinator watches. Each attempt is logged. Nothing is posted until the coordinator has called the farmer and clicks **Create listing**.
- The public page never shows farmer phone numbers or real names.

## Who can see what
- **Anyone** can read harvests that are active and whose farmer has given consent, send a buyer request, and add a line to the phone-test log. They cannot read requests, the log, phone numbers, real names, buyer answers or follow-ups.
- **Coordinators** (listed in the `coordinators` table) can read and write everything.
- A person who signs up without being added in step 4 gets no access to private data.
- Anyone who finds the site can send a request or a phone-test line, so check the Requests tab for junk. There is no spam filter.

## Keys
- The **publishable** key in `config.js` is meant to be public.
- Never put the **secret** or **service_role** key in this folder, in GitHub, or in a chat.

## Hosting
GitHub Pages from the root of the `main` branch. The marketplace is `index.html` (the site address itself), the coordinator page is `/coordinator.html`.
To see the old sample-data version at any time, add `?demo` to the address. It shows made-up people and sends nothing to the database.

## Data protection reminders
- Tick the consent box only after the consent text has been read out.
- A buyer's request carries their own consent to be called (the box on the form).
- The CSV exports use codes (F1, B1) and have no names or phone numbers. Check the free-text columns (messages, notes) before sharing.
- Delete a participant's rows if they ask. Delete everything at the end of the test unless they agreed to be contacted again.

## Not built yet
- Real SMS and USSD: the phone page is a simulation. A real code needs a provider and operator approval.
- Farmer photos: harvests show a plain placeholder. Photos need file storage.
- Farmers and buyers cannot sign in. That is deliberate for this test.
