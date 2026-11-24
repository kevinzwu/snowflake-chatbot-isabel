/**
 * Prepend profile content to the API message string.
 * Mirrors the file-attachment pattern in assembleAgentInput().
 *
 * @param agentInput - The already-assembled agent input (may include file context)
 * @param profileName - The display name of the active profile
 * @param profileContent - The profile's prompt content
 * @returns The input with profile block prepended
 */
export function injectProfileContent(
  agentInput: string,
  profileName: string,
  profileContent: string,
): string {
  return `[User Profile: ${profileName}]\n${profileContent}\n---\n${agentInput}`;
}

/**
 * Generate the "profile cleared" prefix for when a user switches to no profile.
 *
 * @param agentInput - The already-assembled agent input
 * @returns The input with profile-cleared block prepended
 */
export function injectProfileCleared(agentInput: string): string {
  return `[User Profile cleared — respond without previous profile preferences]\n---\n${agentInput}`;
}
