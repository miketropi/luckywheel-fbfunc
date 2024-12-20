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

const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { getFunctions } = require("firebase-admin/functions");
const { logger } = require("firebase-functions/v2");

const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
// const logger = require("firebase-functions/logger");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { GoogleAuth } = require("google-auth-library");

// let auth = null;

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

exports.requestReward = onTaskDispatched({
  retryConfig: {
    maxAttempts: 1,
    minBackoffSeconds: 60,
  },
  rateLimits: {
    maxConcurrentDispatches: 6,
  },
}, async (context) => {
  const taskData = context.data; 
  const uid = taskData?.data?.userid
  const requestID = taskData?.requestID
  const rewardsRef = getFirestore().collection('request_rewards').doc(requestID);
  // Access task data here

  const addTotalProbability = (rewards) => {
    const totalProbability = rewards.reduce((sum, reward) => sum + reward.qty, 0);
    return rewards.map(r => {
      r.probability = (r.qty == 0 ? 0 : parseFloat(((r.qty / totalProbability) * 100).toFixed(2)));
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

  // return {uid}
  // console.log('------uid', uid);
  if(!uid) {
    await rewardsRef.update({
      status: 'error',
      response: {
        error: true,
        message: 'missing userid!!!'
      }
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
  // console.log(rewardSelected);

  if(rewardSelected.qty == 0) {
    await rewardsRef.update({
      status: 'error',
      response: {
        error: true,
        message: 'Phần thưởng đã được phát hết, chúc bạn may mắn lần sau!!!'
      }
    });
    return; 
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

  await rewardsRef.update({ 
    status: 'complete',
    response: {
      uid,
      rewardSelected,
    }
  })
});

app.post('/get-reward-v2', async (request, response) => {
  const queue = getFunctions().taskQueue("requestReward");
  // const targetUri = await getFunctionUrl("requestReward");

  const __request = await getFirestore().collection("request_rewards").add({
    status: 'in-progress',
    payload: request.body,
    response: {}
  }) 

  await queue.enqueue({
    data: request?.body,
    requestID: __request.id,
  })

  return response.status(200).json({
    success: true,
    request: {
      requestID: __request.id,
    },
  }); 
})

let auth = null;
async function getFunctionUrl(name, location="us-central1") {
  if (!auth) {
    auth = new GoogleAuth({
      scopes: "https://www.googleapis.com/auth/cloud-platform",
    });
  }
  const projectId = await auth.getProjectId();
  const url = "https://cloudfunctions.googleapis.com/v2beta/" +
    `projects/${projectId}/locations/${location}/functions/${name}`;

  const client = await auth.getClient();
  const res = await client.request({url});
  const uri = res.data?.serviceConfig?.uri;
  if (!uri) {
    throw new Error(`Unable to retreive uri for function at ${url}`);
  }
  return uri;
}

exports.widgets = onRequest(app);

