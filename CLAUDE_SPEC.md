# Habit Tracker App Specification

## Project Context

This is a mobile-first habit tracker web app located in:

```text
c:\Users\Nazar.Yevtushenko\Downloads\habit-main
```

The app is built with plain HTML, CSS, and JavaScript. It currently uses Firebase Authentication and Cloud Firestore so every user can access their own habits from different devices.

Main files:

```text
index.html
style.css
app.js
```

No bundler is currently used. `app.js` is loaded as an ES module:

```html
<script type="module" src="app.js"></script>
```

Firebase SDK imports are loaded directly from Google's CDN.

## Current Goal

The app should work online with user accounts:

- Users can register with email/password.
- Users can sign in with email/password.
- Users can sign in with Google.
- Every user sees only their own habits.
- Habit data is stored in Firestore.
- Habit data syncs across devices.
- The app keeps the existing mobile dark habit-tracker design.

## Current Firebase Project

Firebase project:

```text
habit-tracket-becca
```

Firebase config currently used in `app.js`:

```js
const firebaseConfig = {
    apiKey: "AIzaSyD9LYpBztKsgNHbOiP_rEcIH8qfIuY59kA",
    authDomain: "habit-tracket-becca.firebaseapp.com",
    projectId: "habit-tracket-becca",
    storageBucket: "habit-tracket-becca.firebasestorage.app",
    messagingSenderId: "860636563411",
    appId: "1:860636563411:web:8656f6dea1be846c9c1126",
    measurementId: "G-4F73KHC1T0"
};
```

Firebase services enabled:

- Authentication
- Email/Password provider
- Google provider
- Cloud Firestore

## Current Known Issue

The app shows:

```text
Этот домен не добавлен в Firebase Authentication.
```

This means Firebase Authentication rejected the current origin/domain.

Likely fixes:

1. Open Firebase Console.
2. Go to Authentication.
3. Go to Settings.
4. Open Authorized domains.
5. Add the domain currently used to open the app.

Examples:

```text
localhost
127.0.0.1
habit-tracket-becca.web.app
habit-tracket-becca.firebaseapp.com
```

If testing from Firebase Hosting, Firebase Hosting domains are usually expected:

```text
habit-tracket-becca.web.app
habit-tracket-becca.firebaseapp.com
```

If testing locally, use a real local server URL such as:

```text
http://localhost:5173
```

Do not test Google sign-in from `file://...`.

## Firestore Data Structure

The app stores data under each user's UID:

```text
users/{uid}/habits/{habitId}
users/{uid}/settings/app
users/{uid}/meta/seed
```

Habit document shape:

```js
{
    name: string,
    icon: string,
    color: "teal" | "violet" | "green" | "amber" | "rose" | "blue",
    order: number,
    repeatDays: number[],
    reminder: {
        enabled: boolean,
        time: string
    },
    lastReminderDate: string,
    history: string[],
    createdAt: number,
    updatedAt: number
}
```

`repeatDays` uses JavaScript weekday numbers:

```text
0 = Sunday
1 = Monday
2 = Tuesday
3 = Wednesday
4 = Thursday
5 = Friday
6 = Saturday
```

`history` stores completed dates as local date strings:

```text
YYYY-MM-DD
```

Settings document shape:

```js
{
    theme: "theme-dark" | "theme-graphite" | "theme-forest" | "theme-light"
}
```

Seed document:

```js
{
    seededAt: number,
    source: "localStorage" | "defaults" | "existing"
}
```

## Firestore Security Rules

Recommended rules:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
        && request.auth.uid == userId;
    }
  }
}
```

These rules allow each signed-in user to read and write only their own data.

## Auth UI

`index.html` includes an auth screen:

- email input
- password input
- "Войти" button
- "Создать аккаунт" button
- "G Войти через Google" button
- auth error message

When no user is signed in:

```text
#auth-view is visible
#app-shell is hidden
```

When a user is signed in:

```text
#auth-view is hidden
#app-shell is visible
```

Logout is available in the settings sheet:

```text
#logout-btn
```

## Main App Features

Implemented user-facing features:

- mobile-first habit list
- add habit
- edit habit
- delete habit
- reorder habits up/down
- mark habit done for today
- weekly view
- overall view
- analytics view
- detail screen for one habit
- current streak
- best streak
- total completions
- 90-day detail grid
- 60-day overview grid
- repeat days per habit
- icon picker
- color picker
- theme picker
- browser notifications while app is open
- migration from older localStorage data on first account seed

## Navigation

Bottom navigation tabs:

```text
Today
Week
Analytics
Overall
```

Detail screen is opened by tapping a habit card.

## Important Code Concepts

`HabitModel` is responsible for:

- Firebase Auth
- Firestore references
- seeding a new user's habits
- listening to habits via `onSnapshot`
- listening to settings via `onSnapshot`
- adding habits
- updating habits
- toggling completion dates
- deleting habits
- moving/reordering habits
- saving theme settings

`HabitView` is responsible for:

- rendering Today
- rendering Weekly
- rendering Overall
- rendering Analytics
- rendering Detail
- updating titles and progress

`HabitPresenter` wires together:

- auth UI
- app UI events
- bottom navigation
- bottom sheets
- notifications
- model updates

## Firebase Paths Used In Code

Habits collection:

```js
collection(db, "users", uid, "habits")
```

Single habit:

```js
doc(db, "users", uid, "habits", habitId)
```

Settings:

```js
doc(db, "users", uid, "settings", "app")
```

Seed marker:

```js
doc(db, "users", uid, "meta", "seed")
```

## Local Data Migration

The app tries to read old local habits from:

```text
habit-main-local-v2
habit-main-local-v1
```

On the first login for a new Firebase user:

1. If the user already has Firestore habits, the app does not seed.
2. If local habits exist, it uploads them.
3. Otherwise, it creates default habits.
4. It writes `users/{uid}/meta/seed`.

## Deployment Recommendation

Use Firebase Hosting.

Commands after Firebase CLI is installed:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

During `firebase init hosting`:

```text
Use existing project: habit-tracket-becca
Public directory: .
Configure as single-page app: No
Overwrite index.html: No
```

Expected hosting URLs:

```text
https://habit-tracket-becca.web.app
https://habit-tracket-becca.firebaseapp.com
```

## Testing Checklist

1. Open the app through `http://localhost:...` or Firebase Hosting, not `file://`.
2. Register a new email/password account.
3. Confirm default habits appear.
4. Add a habit.
5. Refresh the page.
6. Confirm the habit remains.
7. Log out.
8. Log back in.
9. Confirm the same data appears.
10. Try Google sign-in.
11. If Google sign-in shows unauthorized domain, add the current domain in Firebase Authentication settings.
12. Open the app on another device with the same account.
13. Confirm habits sync.

## Current Environment Limitations

In the current local environment:

- `node` was not available.
- `python` was not available.
- A quick local dev server could not be started.
- `node --check app.js` could not be run.

Because the app uses ES modules and Firebase Auth, it should be tested through Firebase Hosting or a local HTTP server, not by directly opening `index.html`.

