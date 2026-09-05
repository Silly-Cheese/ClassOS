import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';

// ClassOS no longer uses Firebase email verification as an authorization
// requirement. A few older UI modules still inspect User.emailVerified when
// deciding whether to expose owner-only controls. Normalize that legacy UI
// signal only; Firestore authorization is enforced independently by rules.
onAuthStateChanged(auth, (user) => {
  if (!user || user.emailVerified) return;
  try {
    user.emailVerified = true;
  } catch {
    try {
      Object.defineProperty(user, 'emailVerified', { value: true, configurable: true });
    } catch {
      // The core sign-in flow no longer depends on this property.
    }
  }
});
