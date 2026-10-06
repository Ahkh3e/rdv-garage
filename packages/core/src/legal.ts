// Working draft of the safety wording from docs/disclaimers.md in the spec repo. A lawyer must review before launch.
export const TERMS_VERSION = "v1";

export const DISCLAIMER_SHORT =
  "Drive safely and obey all laws and speed limits. Don't use your phone while driving. Speeds are GPS estimates for fun, not a challenge to speed. You are responsible for how you drive.";

export const DISCLAIMER_FULL: { title: string; body: string }[] = [
  { title: "You are responsible for your driving", body: "Obey traffic laws, posted speed limits, and road conditions. RDV Garage does not encourage speeding, racing, stunts, or any unsafe or illegal driving." },
  { title: "Don't operate the app while driving", body: "Set up Go live before you start. Once you are live, the map follows you and needs no input. Do not look at or touch your phone while driving. Passengers may use the app." },
  { title: "Top speed is not a contest to break the law", body: "Speeds are estimates measured by your phone's GPS. They can be wrong. The leaderboard is for fun and carries no prize, reward, or endorsement. Never drive unsafely to improve a ranking. If you want to test speed, use a closed course where it is legal." },
  { title: "Your location is shared", body: "When you Go live, the crews you choose can see where you are. Only share with people you trust. Anyone in a crew you choose can see your live position and your top speeds for sessions shared with that crew. You can stop at any time." },
  { title: "Meets and cruises are organized by users", body: "RDV Garage does not organize, supervise, or insure any gathering. You attend at your own risk and are responsible for your own conduct and safety." },
  { title: "Accuracy is not guaranteed", body: "Maps, positions, and speeds may be delayed or wrong. The app is not a navigation or safety tool." },
  { title: "Your account is your responsibility", body: "Keep your password private. You are responsible for activity on your account. If you forget your password, reset it by email; if you lose access to your email, we may not be able to restore your account." },
  { title: "Your email is for your account only", body: "We use it for confirmation and recovery. We do not show it to other users." },
  { title: "You must be 18 or older", body: "Use of the app is limited to adults who are licensed to drive where they drive." },
  { title: "Use at your own risk", body: "To the extent the law allows, RDV Garage is not liable for injury, loss, fines, or damage arising from your use of the app or from the actions of other users." },
];
