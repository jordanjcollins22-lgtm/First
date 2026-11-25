/** The anchor the home screen opens a card at: "Waiting on you" -> s-waiting-on-you. */
export const sectionId = (title: string) => `s-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
