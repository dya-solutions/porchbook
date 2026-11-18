import { useEffect, useState } from "react";

type FirebaseEnv = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
};

export type FirebaseMember = { uid: string; name: string };

function env(): FirebaseEnv {
  const bag = import.meta.env as Record<string, string | undefined>;
  return {
    apiKey: bag.VITE_FIREBASE_API_KEY,
    authDomain: bag.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: bag.VITE_FIREBASE_PROJECT_ID,
    appId: bag.VITE_FIREBASE_APP_ID,
  };
}

export function firebaseReady() {
  const keys = env();
  return Boolean(keys.apiKey && keys.authDomain && keys.projectId && keys.appId);
}

async function auth() {
  const keys = env();
  const { initializeApp, getApps } = await import("firebase/app");
  const { getAuth } = await import("firebase/auth");
  const app = getApps()[0] ?? initializeApp({
    apiKey: keys.apiKey,
    authDomain: keys.authDomain,
    projectId: keys.projectId,
    appId: keys.appId,
  });
  return getAuth(app);
}

export function watchFirebaseMember(onMember: (member: FirebaseMember | null) => void) {
  if (!firebaseReady()) {
    onMember(null);
    return () => undefined;
  }
  let stop = () => undefined as void;
  let closed = false;
  void auth().then(async (client) => {
    const { onAuthStateChanged } = await import("firebase/auth");
    if (closed) return;
    stop = onAuthStateChanged(client, (user) => {
      onMember(user ? { uid: user.uid, name: user.displayName?.trim() || "" } : null);
    });
  });
  return () => {
    closed = true;
    stop();
  };
}

export async function signInForCalls() {
  const client = await auth();
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  await signInWithPopup(client, new GoogleAuthProvider());
}

export function useFirebaseMember() {
  const [member, setMember] = useState<FirebaseMember | null>(null);
  const [ready] = useState(firebaseReady);
  useEffect(() => watchFirebaseMember(setMember), []);
  return { member, ready };
}
