# Photo Frame Studio

A buildless Firebase web app for KUET 4th Convocation 2027. Firebase Hosting serves vanilla HTML, CSS and JavaScript. Firestore contains owner-only drafts and public campaign snapshots. Realtime Database stores 240 × 240 transparent thumbnails and separate 1080 × 1080 transparent frame artwork. Firebase Authentication is loaded only in Super Admin.

## Deploy from Google Cloud Shell

Run these commands using a Google identity with deployment access to `kuetconvocationphotoframe27`.

```sh
git clone https://github.com/swapnilmahfuz/photo-frame-studio.git
cd photo-frame-studio
npx --yes --package firebase-tools@15 bash scripts/deploy-firebase.sh
```

The script retrieves the registered Web App configuration, generates `public/firebase-config.json` locally, and deploys Hosting and both sets of database rules. The generated file contains Firebase client configuration. Service account credentials are separate and should stay outside the checkout. If Cloud Shell asks for Firebase authentication, run `npx --yes firebase-tools@15 login --no-localhost` and repeat the deploy command. If the project has multiple registered web apps, append the intended Web App ID to the deploy command.

Open the deployed Hosting URL with `/admin` appended. Sign in through Google as `swapnilmahfuz20@gmail.com`. Rules require that exact verified email and the Google sign-in provider in both databases. If the Google sign-in popup reports an unauthorized domain, add the deployed Hosting domain under **Firebase Authentication → Settings → Authorized domains**.

For a new campaign database, choose **Load KUET starter artwork**, preview it, and click **Publish**. For a migration, import the existing KUET campaign first so its original link slug is available. Visitor links have the form `/?campaign=kuet-4th-convocation-2027`. The root opens that campaign by default.

## Import an existing Apps Script campaign

The formerly deployed application and original ZIP are preserved in [legacy-apps-script](legacy-apps-script/). Firebase does not use them at runtime.

1. In the existing legacy Apps Script editor, add [Export.gs](legacy-apps-script/Export.gs) as a script file. Save and run `exportLegacyCampaigns` as the legacy owner. This one-time export uses the existing Drive and Sheets records and does not require redeploying Apps Script.
2. Open the private export folder from the execution log. Download the campaign JSON files to your device. Large libraries are subject to Apps Script's export limits.
3. In Firebase Super Admin, use **Import a legacy campaign**, select one JSON file at a time, review the draft, and choose **Save draft** or **Publish**. Drafts stay private. Published campaigns need an explicit publish action in the new app.

The import carries campaign titles, descriptions, slugs, frame ordering and names, enabled states, the default frame and legacy counts as private metadata. Legacy campaign logos, covers, and deleted-frame records remain in the legacy project. The new app does not track visitor exports.

## Manage and verify

- Select one or more PNGs using **Add frames**. The frame counter includes everything in the draft. Use the row controls to replace artwork, disable, reorder or delete a frame.
- If an artwork upload is interrupted, completed uploads are saved to the draft and pending files remain available to retry while the dashboard stays open. An interrupted save leaves the live campaign unchanged.
- **Save draft** keeps changes private. **Publish** replaces the public snapshot with the enabled frames, and **Disable** withdraws the public snapshot and artwork access. Opening the public link again fetches current metadata. A visitor can retain artwork their browser already downloaded.
- The visitor badge shows an approximate total for each published campaign. It counts a browser once using a local flag, and the database stores only the aggregate. Counts start at deployment.
- Public visitors load one campaign document and the selected full-resolution asset. Visible thumbnails load progressively with at most two thumbnail requests in flight. Versioned artwork is cached in the browser. Photo input and exports use browser memory, Canvas and local object URLs.
- Sign out or use an incognito window to verify the campaign and both image downloads. A signed-out visitor should see a sign-in prompt at `/admin`. A non-owner Google account should be denied access to the dashboard.
- Use a mobile device to verify touch drag and pinch, horizontal gallery scrolling, and moving between frames without losing photo placement.
- If an interrupted publish leaves the artwork unavailable, sign in and retry **Publish** or **Disable**. A crashed tab's save lock expires after two minutes. Media from a failed upload may be left in the private Realtime Database and can be reviewed in the Firebase Console.

## Local verification

```sh
npm install
npm run check
npm run test:rules
npx playwright install chromium
npm run test:browser
```

Both suites use a demo project with the Firestore and Realtime Database emulators. Java 21 is required by the Firestore emulator. The browser suite uses a simulated Google identity and a throttled mobile viewport. The website itself has no npm build or runtime package install.
