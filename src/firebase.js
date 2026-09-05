import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBem50jxFC0ovRT83Ok_CKCQqMwkm0bFeI",
  authDomain: "classos-958d3.firebaseapp.com",
  projectId: "classos-958d3",
  storageBucket: "classos-958d3.firebasestorage.app",
  messagingSenderId: "927739542185",
  appId: "1:927739542185:web:7f6d8efa597085543507b8"
};

export const OWNER_EMAIL = "christophershelley257@gmail.com";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({ prompt: "select_account" });
setPersistence(auth, browserLocalPersistence).catch(console.error);
