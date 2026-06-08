// Background script (event page).
//
// Its only job: the first time the extension is installed, open the reader so
// the user lands straight in the first-run onboarding walkthrough. We only do
// this on a fresh install — not on browser restarts or extension updates — so
// it never nags returning users.
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  browser.tabs.create({ url: browser.runtime.getURL("reader.html") });
});
