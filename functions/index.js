/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const express = require('express');
const cors = require('cors');
const app = express();

// Automatically allow cross-origin requests
app.use(cors({ origin: true }));

const {onRequest} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest( async (request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   const querySnapshot = await getFirestore().collection("a1aluckywheel").get().then(querySnapshot => {
//     return querySnapshot.docs.map(doc => {
//       return doc.data();
//     });
//   });

//   return response.status(200).json(querySnapshot);
//   // response.send(JSON.stringify(a1aluckywheel));
// });

app.post('/get-reward', async (request, response) => {

  const addTotalProbability = (rewards) => {
    const totalProbability = rewards.reduce((sum, reward) => sum + reward.qty, 0);
    return rewards.map(r => {
      r.probability = parseFloat(((r.qty / totalProbability) * 100).toFixed(2));
      return r;
    })
  }

  const onPickReward = (__gifts) => {
    const totalProbability = __gifts.reduce((sum, reward) => sum + reward.probability, 0);
    const randomValue = Math.random() * totalProbability;
    let cumulativeProbability = 0;
    for (let i = 0; i < __gifts.length; i++) {
      cumulativeProbability += __gifts[i].probability;
      if (randomValue <= cumulativeProbability) {
        return __gifts[i];
      }
    }
  }

  const uid = request?.body?.userid;

  if(!uid) {
    response.status(500).json({
      error: true,
      message: 'missing userid!!!'
    });
    return;
  }

  const allRewards = await getFirestore().collection("gifts").get().then(querySnapshot => {
    return querySnapshot.docs.map(doc => {
      let d = doc.data();
      d.__id = doc.id
      return d;
    });
  }).then(rewards => {
    return addTotalProbability(rewards);
  });

  let rewardSelected = onPickReward(allRewards);

  if(!rewardSelected) {
    response.status(500).json({
      error: true,
      message: 'Phần thưởng đã được phát hết, chúc bạn may mắn lần sau!!!'
    });
    return
  }

  // update reward qty
  const giftsRef = getFirestore().collection('gifts').doc(rewardSelected.__id);
  await giftsRef.update({qty: rewardSelected.qty - 1});

  // update user reward
  const luckywheelRef = getFirestore().collection('a1aluckywheel').doc(uid);
  await luckywheelRef.update({gift: rewardSelected.name});

  // add logs
  await getFirestore().collection("gift_logs").add({
    userid: uid,
    reward: rewardSelected.name,
    date: new Date(),
  }) 

  return response.status(200).json({
    params: uid,
    reward: rewardSelected,
  });
});

exports.widgets = onRequest(app);