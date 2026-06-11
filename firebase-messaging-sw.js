importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyCMxHV_MpJ9zbL2Hk2v2pFyRZ2XqJZk_Y8",
  authDomain:        "brown-softball.firebaseapp.com",
  projectId:         "brown-softball",
  storageBucket:     "brown-softball.firebasestorage.app",
  messagingSenderId: "235436340088",
  appId:             "1:235436340088:web:03d3f430c7339b16c5ce8d"
});

const messaging = firebase.messaging();

// Handle background push messages (app is closed or in background)
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'Brown Softball', {
    body: body || '',
    icon: '/softball-scheduler/icon-192.png',
    badge: '/softball-scheduler/icon-192.png',
  });
});
