// The installed web app normally handles shares in its service worker.
// If the service worker isn't ready yet, send people to the app instead of an error.
export const onRequestPost = ({ request }) => Response.redirect(new URL('/app/?share=retry', request.url).toString(), 303);
export const onRequestGet = ({ request }) => Response.redirect(new URL('/app/', request.url).toString(), 302);
