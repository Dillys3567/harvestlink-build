# HarvestLink BUILD, step 1: database and coordinator page

## What is in this folder
| File | What it does |
|---|---|
| `schema.sql` | Creates the database tables and the rules about who can see what |
| `config.js` | Your Supabase address and publishable key (safe to be public) |
| `store.js` | Talks to the database. No install needed |
| `coordinator.html` | The page the coordinator uses: add farmers and buyers, post harvests, record buyer answers and follow-ups, download the results |

## Set up (about 15 minutes)
1. In Supabase, open **SQL Editor > New query**, paste all of `schema.sql`, and click **Run**. Running it again later is safe.
2. **Authentication > Users > Add user**. Enter the coordinator's email and a strong password. Tick **Auto Confirm User**.
3. **Authentication > Sign In / Providers**: turn **off** "Allow new users to sign up" (the name may differ slightly).
4. In **SQL Editor**, run this with the coordinator's real email. Repeat for any other coordinator:
   `insert into public.coordinators (user_id) select id from auth.users where email = 'coordinator@example.com';`
5. Open `coordinator.html` (double-click it, or host the folder). Sign in. Add one farmer and one harvest to check it works.
6. Before the real test starts, wipe the practice data. Run this in the SQL Editor:
   `truncate public.responses, public.follow_ups, public.listings, public.buyers, public.farmer_private, public.farmers, public.enquiries cascade;`

## Who can see what
- **Anyone** can read harvests that are active and whose farmer has given consent. They cannot see phone numbers, real names, buyer answers or follow-ups.
- **Coordinators** (listed in the `coordinators` table) can read and write everything.
- A person who signs up without being added in step 4 gets no access to private data.

## Keys
- The **publishable** key in `config.js` is meant to be public.
- Never put the **secret** or **service_role** key in this folder, in GitHub, or in a chat.

## Where to host it
Put these files in a **new** GitHub repository (for example `harvestlink-build`) with its own GitHub Pages. Do not change the repository behind the ENTER submission, so the link you submitted keeps working.

## Data protection reminders
- Tick the consent box only after the consent text has been read out.
- The CSV export uses codes (F1, B1) and has no names or phone numbers. Check the free-text columns before sharing it.
- Delete a participant's rows if they ask.

## Not built yet
The public marketplace pages still show sample data. They are connected to this database in the next step.
