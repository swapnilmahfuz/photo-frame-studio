# Photo Frame Studio

The project starts with **KUET 4th Convocation 2027** and an original Emerald & Gold transparent frame. Setup creates a private Google Sheets database and a private Drive asset folder under the Google account that runs setup. The app serves published artwork through Apps Script and renders visitors' personal photos entirely in their browser.

## Install under the owner account

1. Sign in to Google Apps Script using the Google account that will own the platform. Create a new standalone project named **Photo Frame Studio**.
2. Paste the supplied `Code.gs` into the default script file. Create a script file named `Seed` and paste `Seed.gs`. Create an HTML file named `Index` and paste `Index.html`. In Project Settings, enable **Show "appsscript.json" manifest file in editor**, then paste the supplied manifest into that file.
3. Select `setupPlatform_` in the editor and run it once. Review the requested Drive, Sheets and email identity permissions in Google. Use the intended owner account for this step. The script uses the signed-in email as the owner allowlist, creates the data store and seeds the campaign and frame. A second run by the same owner reuses the configuration.
4. Create the public deployment using **Deploy → New deployment → Web app**. Use **Execute as → Me** and **Who has access → Anyone**. Copy its versioned `/exec` URL.
5. From the same Apps Script project, create a second Web app deployment with **Execute as → Me** and **Who has access → Only myself**. Open that deployment's `/exec` URL with `?view=admin` appended. Both deployments use the same Sheets and Drive data. Every admin operation independently checks both active and effective Google account emails against the identity recorded during setup.
6. In the dashboard, save the public deployment URL. Copy the KUET campaign link from the dashboard. The campaign slug is `kuet-4th-convocation-2027`.

If Google Workspace policy omits **Anyone**, a Workspace administrator must allow anonymous Apps Script web apps, or the app must be installed under an account where anonymous deployments are permitted.

## Verify before sharing

- Open the campaign link in a fresh signed-out browser session. Confirm the campaign, transparent frame and editor load without a Google login. Upload a test photo, move it, pinch-to-zoom on a mobile browser, rotate it, then check both exported files are 1080 × 1080.
- From the same signed-out session, append `?view=admin` to the public deployment base URL and confirm access is denied. Verify the owner-only deployment requires Google sign-in. Test with a different Google account if available.
- Sign in as the owner and open the private dashboard. Confirm the campaign and frame generation counts reflect the exports. Create a draft campaign, add a frame, publish it, and verify its public link in a fresh session. Disable it and confirm the link becomes unavailable on reload.
- Publish changes from the dashboard. New page loads read the latest saved state directly from Sheets, with no code changes or redeployment.

## Operations

Frame designs are square transparent 1080 × 1080 PNG files, up to 8 MB each. Logo and cover files can be PNG or JPG up to 8 MB each. There is no app-defined frame count cap. Google Sheets, Drive and Apps Script limits still apply. Deleted frames are hidden and their files moved to Drive Trash. Their counts are retained in the dashboard. Drive Trash can continue consuming storage until Google removes those files.

Generation counts record browser-reported exports. Retry duplicates are suppressed within the last 100 events per frame. Counts are suitable for usage trends because an anonymous client can report exports independently of saving a local file. The browser sends campaign and frame IDs and a random event ID, with no personal photo data.

The supplied PNG is an original starter design with no institutional logo. It is embedded in `Seed.gs` and is also included for direct upload or replacement.
