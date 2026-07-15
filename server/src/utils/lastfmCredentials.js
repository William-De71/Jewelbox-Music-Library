// Application-level Last.fm credentials, shipped with JewelBox.
//
// These identify the *application* to Last.fm, not any user: they grant no
// access to any account. Each user authorises their own profile through the
// auth flow, which yields a per-user session key stored in the local DB.
// Desktop music players (Strawberry, Clementine, Rhythmbox…) all ship their
// key this way — a client-side secret is unavoidable and Last.fm expects it.
//
// LASTFM_API_KEY / LASTFM_API_SECRET override these, for self-hosters who
// prefer their own application or if the shipped key is ever revoked.
const BUILTIN_API_KEY = 'c8a2a53c5c1deb5ad9e629f3e45eea00';
const BUILTIN_API_SECRET = '8faef77d0f2f21bfa8e9592cbc35b98b';

export function getAppCredentials() {
  return {
    apiKey: process.env.LASTFM_API_KEY || BUILTIN_API_KEY,
    secret: process.env.LASTFM_API_SECRET || BUILTIN_API_SECRET,
  };
}

export function isLastfmAvailable() {
  const { apiKey, secret } = getAppCredentials();
  return Boolean(apiKey && secret);
}
