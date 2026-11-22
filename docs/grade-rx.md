# Grade Rx in Fields

The pilot reuses the Farm Rx sign-in. The configured account can open Grade Rx from Fields after Farm Rx confirms access to a farm it can manage. When Farm Rx closes the session or clears farm access, it removes the workspace. The frame is first-party Farm Rx code and shares its browser origin, so source updates require review as part of the app. Farm Rx passes only an account and farm storage scope to the frame. The Grade Rx entry checks the same-origin parent route and scope before mounting or reading plans. Opening the static document directly shows a message to return to Fields. Its compiled files contain no plans or session values.

Grade Rx stores plans on this device under that account and farm. Signing out closes the workspace and keeps the saved plans for the same account to reopen. Browser storage is not an encrypted vault. Use **Save a copy** before clearing browser data, and use **Open file** to bring a plan over from the earlier preview.

## Build the pilot

- For an isolated local test, build the reviewed Grade Rx checkout with `npm run build -- --mode farm-rx`. Set `GRADE_RX_LOCAL_BUILD` to its `dist` directory. Set `VITE_GRADE_RX_PILOT_USER_ID` to the synthetic Farm Rx pilot ID `00000000-0000-4000-8000-000000000001` when running the pilot Playwright test.
- For an approved hosted pilot, configure `VITE_GRADE_RX_PILOT_USER_ID` for the approved Farm Rx account and `GRADE_RX_SOURCE_TOKEN` as a build-time read credential for only the private Grade Rx repository. The build script pins the reviewed source commit, downloads it and installs its locked dependencies without lifecycle scripts. It builds the package with an isolated subprocess environment and publishes only the compiled browser assets. Update the source pin through a reviewed Farm Rx change.
- With the pilot ID unset, Farm Rx keeps the existing protected preview link. With the pilot ID set, a missing or incorrect Grade Rx build fails the deployment.

Pilot proof covers Fields launch, sign-out, and farm switching in both desktop and phone-sized browsers. The Grade Rx frame receives its own content policy for public map and data services. The Farm Rx page keeps its existing policy.

The private source pinned at `25c4f8d7623db6034f197a63480e9e4f19124aa7` completed its independent Luna and Sol reviews. The connected source review traced its parent-window and storage access. Grade Rx checks the parent route at startup, and storage value reads and writes use Grade Rx's account-and-farm keys. Desktop and phone-sized browser runs instrumented the frame and verified it did not read a synthetic Farm Rx session value. A source-pin change moves first-party Farm Rx code and must carry the same verification.
