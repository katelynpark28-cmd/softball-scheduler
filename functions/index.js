const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// Fires whenever the announcements document is written (new announcement posted)
exports.notifyOnAnnouncement = functions.firestore
  .document('store/announcements')
  .onWrite(async (change) => {
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;
    if (!after) return;

    const newList = after.value || [];
    const oldList = (before && before.value) || [];

    // Only notify if a new announcement was added at the front
    if (newList.length <= oldList.length) return;
    const latest = newList[0];
    if (!latest) return;

    // Read all saved FCM tokens
    const tokensDoc = await admin.firestore().collection('store').doc('fcm_tokens').get();
    if (!tokensDoc.exists) return;
    const tokensMap = tokensDoc.data() || {};
    const tokens = Object.values(tokensMap).filter(Boolean);
    if (tokens.length === 0) return;

    const message = {
      notification: {
        title: 'Brown Softball',
        body: latest.text || 'New announcement',
      },
      tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Clean up any invalid/expired tokens
    const invalid = [];
    response.responses.forEach((r, i) => {
      if (!r.success) invalid.push(tokens[i]);
    });
    if (invalid.length > 0) {
      const updated = { ...tokensMap };
      Object.keys(updated).forEach(uid => {
        if (invalid.includes(updated[uid])) delete updated[uid];
      });
      await admin.firestore().collection('store').doc('fcm_tokens').set(updated);
    }
  });
