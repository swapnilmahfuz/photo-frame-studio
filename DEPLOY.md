# Install Photo Frame Studio

Use your existing **KUETCONVOCATIONPHOTOFRAME27** Apps Script project. Sign in as the Google account that should be the sole Super Admin.

## Copy three files

Open each link and copy the full file into the matching location in the Apps Script editor.

| File to copy | Where it goes |
| --- | --- |
| [Code.gs](https://raw.githubusercontent.com/swapnilmahfuz/photo-frame-studio/main/Code.gs) | Replace the contents of the default `Code.gs` script file. This includes the setup function and the Emerald & Gold starter frame. |
| [Index.html](https://raw.githubusercontent.com/swapnilmahfuz/photo-frame-studio/main/Index.html) | In **Editor → Add a file → HTML**, name the file `Index` and paste the contents. |
| [appsscript.json](https://raw.githubusercontent.com/swapnilmahfuz/photo-frame-studio/main/appsscript.json) | In **Project Settings**, enable **Show “appsscript.json” manifest file in editor**. Return to **Editor**, open that file, and replace its contents. |

## Run setup before deploying

1. Save the project. In the function dropdown, select **setupPlatform** and click **Run**.
2. Authorize Google Sheets, Drive, and email identity access with the owner account. Run **setupPlatform** again if the first run stops after authorization.
3. Confirm **Configured** in the execution log. Setup creates the private **Photo Frame Studio • Database** spreadsheet and **Photo Frame Studio • Assets** Drive folder, publishes the starter campaign and frame, and records the current Google account as the sole Super Admin. An owner rerun logs **Already configured** and reuses the existing resources.

## Create two web app deployments

Use **Deploy → New deployment → Web app** for each row. Deploy both under the same Google account that ran setup.

| Deployment | Execute as | Who has access | What to open |
| --- | --- | --- | --- |
| Public editor | Me | Anyone | Copy the web app URL ending in `/exec`. |
| Super Admin | Me | Only myself | Open this deployment’s `/exec` URL followed by `?view=admin`. |

In the Super Admin dashboard, paste the public deployment’s base `/exec` URL into **Public web app URL** and click **Save public URL**. Choose **KUET 4th Convocation 2027** and click **Copy campaign link**. Its URL ends in `?campaign=kuet-4th-convocation-2027`.

If your Workspace account omits **Anyone**, ask your Workspace administrator whether anonymous web apps are allowed. For the dashboard, use a browser session signed in as the same Google account that ran setup.

## Verify before sharing

- In a signed-out browser window, open the campaign link. Confirm that the editor and starter frame load, then export a sample photo as PNG and JPG. Both files should be 1080 × 1080.
- In that window, open the public base URL followed by `?view=admin` and confirm that the app denies dashboard access. The separate Super Admin deployment should require the owner’s Google sign-in.
- In the owner dashboard, verify that the generation counts incremented. Campaign and frame edits take effect on fresh page loads without a new deployment.

## Manage campaigns and frames

Upload transparent square PNG frames at any resolution, up to 8 MB each. The browser resizes each frame to 1080 × 1080 during upload, and finished exports are 1080 × 1080. Logo and cover images accept PNG or JPG up to 8 MB. Deleted frames move to Drive Trash and retain their historical generation counts. Exports use the visitor’s browser to process personal photos. The server receives campaign and frame IDs with a random event ID for usage counts.

The repository’s ZIP is the original archive. Use the three copy links above for this installation.
