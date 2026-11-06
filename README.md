# VikasDisha CRM

Standalone React CRM for the VikasDisha Expo app. It provides pages for platform overview, people, jobs, recruitment pipeline, subscription revenue and connection settings.

## Run in demo mode

```bash
npm install
npm run dev
```

Without a `.env` file, the CRM opens with demonstration data so the UI can be reviewed immediately.

## Connect Firebase

Copy `.env.example` to `.env`, then fill in the public Firebase web configuration from `expo-app/firebase.ts`. Do not place Razorpay, Resend, or Firebase Functions secrets in this file.

The signed-in user must have `role: "admin"` in `users/{uid}` in Firestore. Deploy the rules from the Expo project before using live CRM data:

```bash
cd ../expo-app
firebase deploy --only firestore:rules --project vikasdisha
```

The CRM reads `users`, `jobs`, `applications`, and `paymentOrders`. Administrators can move applications between pipeline stages; the app updates only the application `status` field.

## Production build

```bash
npm run build
```
