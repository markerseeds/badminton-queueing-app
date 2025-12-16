// lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCSXqPJwB1lfy4_cwShgwhToQx_tb8GeiI",
  authDomain: "badminton-queueing-app-726ef.firebaseapp.com",
  projectId: "badminton-queueing-app-726ef",
  storageBucket: "badminton-queueing-app-726ef.firebasestorage.app",
  messagingSenderId: "1067630433788",
  appId: "1:1067630433788:web:4b4404919c3ab19d538e79",
  measurementId: "G-JPEGBTJMNC",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
