export class AppError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "AppError";
  }
}

const MESSAGES: Record<string, string> = {
  invalid_invite: "That invite isn't valid. Ask the person who shared it for a new one.",
  expired_invite: "That invite has expired. Ask the person who shared it for a new one.",
  revoked_invite: "That invite is no longer active. Ask the person who shared it for a new one.",
  handle_taken: "That handle is taken.",
  icon_invalid: "That car is not available.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers, and underscores.",
  handle_cooldown: "You can change your handle once every 30 days.",
  email_invalid: "Enter a valid email address.",
  email_in_use: "That email already has an account.",
  password_too_short: "Use at least 8 characters.",
  wrong_password: "That password is not right.",
  email_unconfirmed: "Confirm your email first. Check your inbox for the link.",
  reset_link_invalid: "That reset link has expired. Request a new one.",
  terms_required: "Accept the terms to continue.",
  age_confirmation_required: "You must be 18 or older.",
  invalid_crew_link: "That crew link isn't valid.",
  crew_name_invalid: "Crew names are 3 to 30 characters.",
  crew_description_invalid: "Descriptions are up to 140 characters.",
  not_a_member: "You're not in that crew.",
  not_owner: "Only the crew owner can do that.",
  not_moderator: "Only the crew owner or an admin can do that.",
  cannot_moderate_admin: "Only the owner can remove an admin or the owner.",
  owner_must_transfer: "Transfer ownership before leaving, or delete the crew.",
  session_not_found: "That session is no longer active.",
  suspended: "This account has been suspended.",
  revoke_failed: "Your password was changed, but we couldn't sign out your other devices. Do that from Me, Devices.",
  invalid_checkpoint: "That reading was not valid.",
  pin_label_invalid: "Pin labels are 3 to 40 characters.",
  pin_note_invalid: "Notes are up to 140 characters.",
  pin_place_invalid: "That place isn't valid.",
  pin_crew_required: "Choose at least one crew.",
  pin_not_found: "That pin is gone.",
  location_denied: "Location is off. Turn it on in Settings to mark arrival.",
  rdv_not_found: "That RDV is gone.",
  rdv_in_past: "An RDV can't start in the past.",
  rdv_closed: "That RDV has ended or was cancelled.",
  outside_radius: "You're not at the RDV yet. Get closer and try again.",
  outside_window: "You can mark arrival from an hour before the start until the RDV ends.",
  rdv_title_invalid: "RDV titles are 3 to 60 characters.",
  rdv_kind_invalid: "Choose meet, cruise or private event.",
  rdv_area_required: "Name the general area for a private event, such as a neighbourhood. It is shown before people answer, so leave out the street.",
  rdv_place_invalid: "Choose a place for the RDV.",
  rdv_note_invalid: "Notes are up to 280 characters.",
  rdv_radius_invalid: "The arrival radius is 50 to 500 metres.",
  rdv_time_invalid: "Choose a start time.",
  rdv_end_invalid: "The end must be after the start.",
  rdv_crew_required: "Choose at least one crew.",
  rdv_answer_invalid: "That answer isn't valid.",
  not_host: "Only the host can change an RDV.",
  invalid_query: "Type at least 3 characters.",
  search_unavailable: "Search isn't available right now. Try again.",
  geocoder_unavailable: "Search isn't available right now.",
  rate_limited: "Too many attempts. Try again later.",
  unauthenticated: "Sign in to continue.",
  registration_failed: "We couldn't create your account. Try again.",
  deletion_failed: "We couldn't delete your account. Try again.",
  invalid_login: "Email or password is not right.",
  handoff_unavailable: "Directions are not available right now.",
  network: "Can't reach RDV Garage. Check your connection.",
  unknown_error: "Something went wrong. Try again.",
};

export function messageFor(error: unknown): string {
  const code = error instanceof AppError ? error.code : "unknown_error";
  return MESSAGES[code] ?? MESSAGES.unknown_error!;
}

export function codeOf(error: unknown): string {
  return error instanceof AppError ? error.code : "unknown_error";
}
