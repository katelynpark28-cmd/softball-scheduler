// Brown Softball — Firebase initialization
// Loaded before app.js on every page.

const _firebaseConfig = {
  apiKey:            "AIzaSyCMxHV_MpJ9zbL2Hk2v2pFyRZ2XqJZk_Y8",
  authDomain:        "brown-softball.firebaseapp.com",
  projectId:         "brown-softball",
  storageBucket:     "brown-softball.firebasestorage.app",
  messagingSenderId: "235436340088",
  appId:             "1:235436340088:web:03d3f430c7339b16c5ce8d"
};

firebase.initializeApp(_firebaseConfig);
window.fbDb   = firebase.firestore();
window.fbAuth = firebase.auth();
