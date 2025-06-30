// script.js

// --- Global Variables ---
let telegramUser = null;
let db = null;
let currentUserData = null; // Store current user data from Firestore
let adCooldownTimer = null;
const DAILY_FREE_SPINS = 20;
const DAILY_AD_SPINS = 10;
const MAX_DAILY_ADS = 38;
const AD_COOLDOWN_SECONDS = 25;
const TASK_POINTS = 30; // Points per task
const REFERRER_BONUS = 10;
const REFERRED_BONUS = 5;
const FIRST_WITHDRAWAL_MIN = 1750;
const FIRST_WITHDRAWAL_AMOUNT_USD = 0.10;

// Task Links (Keep consistent with index.html)
const taskLinks = {
    1: "https://t.me/AGuttuGhosh",
    2: "https://t.me/AGuttuGhoshChat",
    3: "https://t.me/ShopEarnHub4102h",
    4: "https://t.me/earningsceret"
};


// --- Utility Functions ---

// Get start of UTC day timestamp
function getUtcDayTimestamp() {
    const now = new Date();
    const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return utc; // Returns milliseconds since epoch UTC start
}

// Check if timestamp is for today's UTC day
function isTodayUtc(timestamp) {
    if (!timestamp) return false;
    const todayUtc = getUtcDayTimestamp();
    // Firestore timestamps often come as objects with toMillis()
    const timestampMillis = typeof timestamp.toMillis === 'function' ? timestamp.toMillis() : timestamp;
    const itemUtc = Date.UTC(new Date(timestampMillis).getUTCFullYear(), new Date(timestampMillis).getUTCMonth(), new Date(timestampMillis).getUTCDate());
    return itemUtc === todayUtc;
}

// Format points with commas
function formatPoints(points) {
    return points.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Update UI elements that display points
function updatePointsUI(points) {
    const formattedPoints = formatPoints(points);
    document.getElementById('header-points').textContent = formattedPoints;
    // Update points in Profile and Withdraw sections if visible/needed
    if (document.getElementById('profile-section').classList.contains('active')) {
         document.getElementById('profile-points').textContent = formattedPoints;
    }
     if (document.getElementById('withdraw-section').classList.contains('active')) {
         document.getElementById('withdraw-points').textContent = formattedPoints;
    }
}

// Show message below elements
function showMessage(elementId, text, isError = false, isSuccess = false) {
    const msgElement = document.getElementById(elementId);
    if (msgElement) {
        msgElement.textContent = text;
        msgElement.classList.remove('error', 'success');
        if (isError) msgElement.classList.add('error');
        if (isSuccess) msgElement.classList.add('success');
    }
}

function clearMessage(elementId) {
     const msgElement = document.getElementById(elementId);
     if (msgElement) {
         msgElement.textContent = '';
         msgElement.classList.remove('error', 'success');
     }
}


// --- Firebase Initialization and User Handling ---

async function initializeFirebaseAndUser() {
    try {
        // Initialize Firebase App
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();

        // Get Telegram User Data
        if (Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
            telegramUser = Telegram.WebApp.initDataUnsafe.user;
            console.log("Telegram User Data:", telegramUser);

            const userId = telegramUser.id;
            const username = telegramUser.username || `user${userId}`; // Use ID if no username
            const firstName = telegramUser.first_name || '';
            const lastName = telegramUser.last_name || '';
            const fullName = `${firstName} ${lastName}`.trim();
            const photoUrl = telegramUser.photo_url || 'placeholder.png'; // Use a default placeholder

            // Check if user exists in Firestore
            const userRef = db.collection('users').doc(String(userId));
            const userDoc = await userRef.get();

            if (!userDoc.exists) {
                console.log("New user! Creating profile.");
                // New user: Create document
                currentUserData = {
                    telegram_user_id: userId,
                    telegram_username: username,
                    full_name: fullName,
                    photo_url: photoUrl,
                    points: 0,
                    energy: 500, // Default energy as per DB structure
                    max_energy: 500, // Default max energy
                    referral_code: `A${username}`, // Generate code
                    referred_by_user_id: null, // No referrer initially
                    referral_code_used: false, // Has not used a code
                    referrals_count: 0,
                    last_spin_utc_day: new Date(0), // Reset spins for today
                    daily_spins_left: DAILY_FREE_SPINS,
                    daily_ad_spins_left: DAILY_AD_SPINS,
                    last_ad_watch_utc: new Date(0), // Reset ads for today
                    daily_ads_watched_count: 0,
                    last_task_claim_utc_day: new Date(0), // Reset tasks for today
                    task1_completed_utc_day: null,
                    task2_completed_utc_day: null,
                    task3_completed_utc_day: null,
                    task4_completed_utc_day: null,
                    claimed_first_withdrawal: false,
                    created_at: firebase.firestore.FieldValue.serverTimestamp(),
                    updated_at: firebase.firestore.FieldValue.serverTimestamp(),
                };
                await userRef.set(currentUserData);
                console.log("User profile created:", currentUserData);

                 // Check for deep-linked referral code
                 if (Telegram.WebApp.initDataUnsafe.start_param) {
                     const refCode = Telegram.WebApp.initDataUnsafe.start_param;
                      console.log("Detected start_param:", refCode);
                      // Automatically attempt to apply referral code if valid
                      // Add a small delay to ensure user data is fully set
                     setTimeout(() => handleSubmitReferral(refCode), 1000);
                 }


            } else {
                // Existing user: Load data
                currentUserData = userDoc.data();
                console.log("Existing user loaded:", currentUserData);
                // Update username/name/photo if they changed in Telegram
                 if (currentUserData.telegram_username !== username ||
                     currentUserData.full_name !== fullName ||
                     currentUserData.photo_url !== photoUrl) {
                      console.log("Updating user data in Firestore...");
                      await userRef.update({
                          telegram_username: username,
                          full_name: fullName,
                          photo_url: photoUrl,
                          updated_at: firebase.firestore.FieldValue.serverTimestamp()
                      });
                     // Update local data after successful DB update
                     currentUserData.telegram_username = username;
                     currentUserData.full_name = fullName;
                     currentUserData.photo_url = photoUrl;
                     currentUserData.updated_at = new Date(); // Approximate local update
                 }
            }

            // Perform daily resets after loading/creating user data
            performDailyResets();

            // Update UI with user data
            updateHeaderUI();
            updateProfileUI();
            updateSpinUI();
            updateTaskUI();
            updateAdsUI();
             updateReferralUI();
             updateWithdrawUI(); // Ensure points are updated in withdraw section


            // Hide loading screen and show the app
            document.getElementById('loading-screen').style.opacity = 0;
            setTimeout(() => {
                document.getElementById('loading-screen').style.display = 'none';
                Telegram.WebApp.ready(); // Notify Telegram that the app is ready
            }, 300);

        } else {
            console.error("Telegram WebApp user data not available.");
            document.getElementById('loading-screen').innerHTML = '<p class="message error">Error: Could not get Telegram user data. Please open from Telegram.</p>';
             Telegram.WebApp.ready();
             Telegram.WebApp.showAlert('Error: Could not get Telegram user data. Please open the WebApp from a Telegram bot or channel link.');
        }

    } catch (error) {
        console.error("Error initializing Firebase or user:", error);
        document.getElementById('loading-screen').innerHTML = `<p class="message error">Error loading app: ${error.message}</p>`;
         Telegram.WebApp.ready();
         Telegram.WebApp.showAlert(`Error loading app: ${error.message}`);
    }
}

// Update header display
function updateHeaderUI() {
     if (currentUserData) {
         document.getElementById('header-user-photo').src = currentUserData.photo_url || 'placeholder.png';
         document.getElementById('header-username').textContent = currentUserData.telegram_username;
         updatePointsUI(currentUserData.points);
     }
}

// Update profile section display
function updateProfileUI() {
    if (currentUserData) {
        document.getElementById('profile-user-photo').src = currentUserData.photo_url || 'placeholder.png';
        document.getElementById('profile-username').textContent = currentUserData.telegram_username;
        document.getElementById('profile-full-name').textContent = currentUserData.full_name;
        document.getElementById('profile-telegram-id').textContent = currentUserData.telegram_user_id;
        document.getElementById('profile-referral-code').textContent = currentUserData.referral_code;
        document.getElementById('profile-referrals-count').textContent = currentUserData.referrals_count;
        document.getElementById('profile-points').textContent = formatPoints(currentUserData.points);
         // Energy display if needed
         // document.getElementById('profile-energy').textContent = currentUserData.energy;
         // document.getElementById('profile-max-energy').textContent = currentUserData.max_energy;
    }
}

// --- Daily Reset Logic ---
function performDailyResets() {
    const todayUtc = getUtcDayTimestamp();
    const userRef = db.collection('users').doc(String(telegramUser.id));
    let updateData = {};
    let dataChanged = false;

    // Spins Reset
    const lastSpinDay = typeof currentUserData.last_spin_utc_day.toMillis === 'function' ? new Date(currentUserData.last_spin_utc_day.toMillis()).setUTCHours(0, 0, 0, 0) : new Date(currentUserData.last_spin_utc_day).setUTCHours(0, 0, 0, 0);

    if (lastSpinDay !== todayUtc) {
        console.log("Resetting daily spins.");
        updateData.daily_spins_left = DAILY_FREE_SPINS;
        updateData.daily_ad_spins_left = DAILY_AD_SPINS;
        updateData.last_spin_utc_day = firebase.firestore.FieldValue.serverTimestamp(); // Use server timestamp for accuracy
        currentUserData.daily_spins_left = DAILY_FREE_SPINS; // Update local copy
        currentUserData.daily_ad_spins_left = DAILY_AD_SPINS; // Update local copy
        currentUserData.last_spin_utc_day = new Date(); // Approximate local update
        dataChanged = true;
    }

    // Ads Reset
     const lastAdDay = typeof currentUserData.last_ad_watch_utc.toMillis === 'function' ? new Date(currentUserData.last_ad_watch_utc.toMillis()).setUTCHours(0, 0, 0, 0) : new Date(currentUserData.last_ad_watch_utc).setUTCHours(0, 0, 0, 0);

    if (lastAdDay !== todayUtc) {
        console.log("Resetting daily ads watched count.");
        updateData.daily_ads_watched_count = 0;
        // last_ad_watch_utc is used for cooldown, not daily reset date tracker
        // updateData.last_ad_watch_utc = firebase.firestore.FieldValue.serverTimestamp(); // This is for cooldown, not daily reset marker
        currentUserData.daily_ads_watched_count = 0; // Update local copy
         // currentUserData.last_ad_watch_utc = new Date(); // Update local copy (not strictly needed for daily reset)
        dataChanged = true;
    }


    // Tasks Reset (Reset if last claim was NOT today UTC)
     const lastTaskClaimDay = typeof currentUserData.last_task_claim_utc_day.toMillis === 'function' ? new Date(currentUserData.last_task_claim_utc_day.toMillis()).setUTCHours(0, 0, 0, 0) : new Date(currentUserData.last_task_claim_utc_day).setUTCHours(0, 0, 0, 0);

    if (lastTaskClaimDay !== todayUtc) {
        console.log("Resetting daily tasks.");
        updateData.task1_completed_utc_day = null;
        updateData.task2_completed_utc_day = null;
        updateData.task3_completed_utc_day = null;
        updateData.task4_completed_utc_day = null;
         // Do NOT reset last_task_claim_utc_day here, it's only set WHEN claimed.
        currentUserData.task1_completed_utc_day = null; // Update local copy
        currentUserData.task2_completed_utc_day = null;
        currentUserData.task3_completed_utc_day = null;
        currentUserData.task4_completed_utc_day = null;
        dataChanged = true;
    }


    // Commit updates if any reset occurred
    if (dataChanged) {
        updateData.updated_at = firebase.firestore.FieldValue.serverTimestamp(); // Update timestamp
        userRef.update(updateData)
            .then(() => console.log("Daily resets committed to Firestore."))
            .catch(error => console.error("Error during daily resets:", error));
    }
}


// --- Navigation ---
document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => {
        const sectionId = button.dataset.section;
        showSection(sectionId);
    });
});

function showSection(sectionId) {
    document.querySelectorAll('.app-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(sectionId).classList.add('active');

    document.querySelectorAll('.nav-item').forEach(button => {
        button.classList.remove('active');
        if (button.dataset.section === sectionId) {
            button.classList.add('active');
        }
    });

     // Update section-specific UI when it becomes active
    if (sectionId === 'profile-section') updateProfileUI();
    if (sectionId === 'spin-section') updateSpinUI();
    if (sectionId === 'task-section') updateTaskUI();
    if (sectionId === 'watch-ads-section') updateAdsUI();
     if (sectionId === 'referral-section') updateReferralUI();
    if (sectionId === 'withdraw-section') updateWithdrawUI();
}


// --- Spin Section Logic ---
const spinButton = document.getElementById('spin-button');
const spinsLeftSpan = document.getElementById('spins-left');
const adSpinsLeftSpan = document.getElementById('ad-spins-left');
const spinMessage = document.getElementById('spin-message');

function updateSpinUI() {
    if (currentUserData) {
        spinsLeftSpan.textContent = currentUserData.daily_spins_left;
        adSpinsLeftSpan.textContent = currentUserData.daily_ad_spins_left;

        if (currentUserData.daily_spins_left > 0) {
            spinButton.textContent = "Spin Now!";
            spinButton.disabled = false;
             spinButton.classList.remove('button-glow-pulse-blue'); // Stop any ad glow
             spinButton.classList.add('button-glow-pulse-red'); // Add spin glow
            clearMessage('spin-message');
        } else if (currentUserData.daily_ad_spins_left > 0) {
             spinButton.textContent = "Watch Ad for 2 Spins";
            spinButton.disabled = false; // Enable button to watch ad
             spinButton.classList.remove('button-glow-pulse-red'); // Stop spin glow
             spinButton.classList.add('button-glow-pulse-blue'); // Add ad glow
            showMessage('spin-message', `You're out of free spins. Watch an ad for ${DAILY_AD_SPINS} more ad-spins!`);
        }
        else {
            spinButton.textContent = "No Spins Left Today";
            spinButton.disabled = true;
             spinButton.classList.remove('button-glow-pulse-red', 'button-glow-pulse-blue'); // Stop glows
            showMessage('spin-message', "You've used all your spins and ad-spins for today. Check back tomorrow!");
        }
    }
}

spinButton.addEventListener('click', handleSpin);

async function handleSpin() {
    if (!currentUserData || !db) return;
    clearMessage('spin-message');
    spinButton.disabled = true; // Prevent double clicking

    const userId = String(currentUserData.telegram_user_id);
    const userRef = db.collection('users').doc(userId);

     // Re-fetch data to ensure it's fresh before updating
     const userDoc = await userRef.get();
     if (!userDoc.exists) {
         showMessage('spin-message', 'User data not found.', true);
         spinButton.disabled = false;
         return;
     }
     currentUserData = userDoc.data(); // Update local copy with latest data
     performDailyResets(); // Ensure resets are checked with fresh data
     updateSpinUI(); // Update UI based on fresh data


    if (currentUserData.daily_spins_left > 0) {
        // --- Handle Free Spin ---
        const pointsEarned = Math.random() < 0.8 ?
                           Math.floor(Math.random() * (15 - 2 + 1)) + 2 : // 80% chance: 2-15 points
                           Math.floor(Math.random() * (25 - 16 + 1)) + 16; // 20% chance: 16-25 points

        const newSpinsLeft = currentUserData.daily_spins_left - 1;
        const newPoints = currentUserData.points + pointsEarned;

        try {
            await userRef.update({
                daily_spins_left: newSpinsLeft,
                points: newPoints,
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            });
            currentUserData.daily_spins_left = newSpinsLeft; // Update local
            currentUserData.points = newPoints; // Update local
            updatePointsUI(newPoints);
            updateSpinUI();
            showMessage('spin-message', `🎉 You won ${pointsEarned} points!`, true, true); // Use success style for wins

        } catch (error) {
            console.error("Error updating user data after spin:", error);
             showMessage('spin-message', `Error spinning: ${error.message}`, true);
        } finally {
            spinButton.disabled = false; // Re-enable button
        }

    } else if (currentUserData.daily_ad_spins_left > 0) {
         // --- Handle Ad Spin ---
         console.log("Attempting to show ad for spins...");
         showMessage('spin-message', 'Loading ad...', false);

         // Monetag Rewarded Interstitial Code
         if (typeof show_9342950 === 'function') {
             show_9342950().then(() => {
                 console.log('Ad shown successfully. Rewarding user.');
                 // Ad watched successfully, now reward the user with spins

                 const newAdSpinsLeft = currentUserData.daily_ad_spins_left - 1;
                 const bonusSpins = 2; // As per requirement

                 userRef.update({
                     daily_ad_spins_left: newAdSpinsLeft,
                     daily_spins_left: currentUserData.daily_spins_left + bonusSpins, // Add bonus spins to free spins count
                     last_ad_watch_utc: firebase.firestore.FieldValue.serverTimestamp(), // Record ad watch time for cooldown
                     updated_at: firebase.firestore.FieldValue.serverTimestamp()
                 })
                 .then(() => {
                     currentUserData.daily_ad_spins_left = newAdSpinsLeft; // Update local
                      currentUserData.daily_spins_left += bonusSpins; // Update local
                     currentUserData.last_ad_watch_utc = new Date(); // Update local approx

                     updateSpinUI(); // Update UI with new spin counts
                      showMessage('spin-message', `✅ You earned ${bonusSpins} bonus spins!`, true, true); // Use success style
                 })
                 .catch(error => {
                     console.error("Error updating user data after ad spin:", error);
                      showMessage('spin-message', `Error rewarding spins: ${error.message}`, true);
                 })
                 .finally(() => {
                     spinButton.disabled = false; // Re-enable button
                 });

             }).catch(error => {
                 // Ad failed to load or user closed it without completing
                 console.error('Monetag ad failed or incomplete:', error);
                 showMessage('spin-message', 'Could not show ad. Please try again.', true);
                 spinButton.disabled = false; // Re-enable button
             });
         } else {
              console.error("Monetag SDK function show_9342950 not found.");
              showMessage('spin-message', 'Ad service not available.', true);
              spinButton.disabled = false;
         }

    } else {
        // Should be disabled by updateSpinUI, but good to double check
        showMessage('spin-message', "No spins or ad-spins left today.", true);
        spinButton.disabled = true;
    }
}


// --- Task Section Logic ---
const claimTasksButton = document.getElementById('claim-tasks-button');
const taskStatusMessage = document.getElementById('task-status-message');

function updateTaskUI() {
    if (!currentUserData) return;

    const todayUtc = getUtcDayTimestamp();
    let allCompletedToday = true;

    for (let i = 1; i <= 4; i++) {
        const taskId = `task-${i}`;
        const taskElement = document.getElementById(taskId);
        const taskButton = taskElement.querySelector('.task-button');
        const taskStatusSpan = taskElement.querySelector('.task-status');
        const completionField = `task${i}_completed_utc_day`;
        const completedTimestamp = currentUserData[completionField];

        const isCompletedToday = isTodayUtc(completedTimestamp);

        if (isCompletedToday) {
            taskElement.classList.add('completed');
            taskStatusSpan.textContent = 'Done';
            taskButton.disabled = true;
        } else {
            taskElement.classList.remove('completed');
            taskStatusSpan.textContent = 'Pending';
            taskButton.disabled = false;
            allCompletedToday = false; // Mark as not all completed if any is pending today
        }
    }

    // Check if points were already claimed for today
    const claimedToday = isTodayUtc(currentUserData.last_task_claim_utc_day);

    if (allCompletedToday && !claimedToday) {
        claimTasksButton.disabled = false;
        claimTasksButton.textContent = "Claim Daily Task Points (120)";
         showMessage('task-status-message', 'All tasks completed! Claim your points.', true, true);
    } else if (claimedToday) {
        claimTasksButton.disabled = true;
        claimTasksButton.textContent = "Points Claimed Today";
         showMessage('task-status-message', 'Daily task points already claimed.', false);
    }
    else {
        claimTasksButton.disabled = true;
        claimTasksButton.textContent = "Complete All Tasks First";
         showMessage('task-status-message', 'Complete all tasks listed above.', false);
    }
}

document.querySelectorAll('.task-button').forEach(button => {
    button.addEventListener('click', async (event) => {
        const taskId = event.target.dataset.taskId;
        const url = event.target.dataset.url;

        if (!currentUserData || !db) return;

        // Mark task as completed for today immediately in UI
        const taskElement = document.getElementById(`task-${taskId}`);
        const taskButton = taskElement.querySelector('.task-button');
        const taskStatusSpan = taskElement.querySelector('.task-status');

         taskButton.disabled = true; // Disable button after click
         taskStatusSpan.textContent = 'Processing...'; // Show intermediate status

        // Open the link
        Telegram.WebApp.openLink(url);

        // --- Security Warning ---
        // In a real app, verification (e.g., bot checking membership) would happen here.
        // For this example, we trust the user clicked and mark it complete locally and in DB.
        // This is INSECURE.

        const userId = String(currentUserData.telegram_user_id);
        const userRef = db.collection('users').doc(userId);
        const completionField = `task${taskId}_completed_utc_day`;

         try {
            // Use server timestamp to mark completion for today UTC
            await userRef.update({
                [completionField]: firebase.firestore.FieldValue.serverTimestamp(),
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Update local data after successful DB write
             currentUserData[completionField] = new Date(); // Approximate local update time
            updateTaskUI(); // Re-render task UI based on updated data
             showMessage('task-status-message', `Task ${taskId} marked as completed.`, false);

         } catch (error) {
             console.error(`Error marking task ${taskId} as completed:`, error);
             showMessage('task-status-message', `Error marking task ${taskId}. Try again.`, true);
             // Re-enable button or revert UI state if update failed
             taskButton.disabled = false;
             taskStatusSpan.textContent = 'Pending';
              taskElement.classList.remove('completed');
         }
    });
});

claimTasksButton.addEventListener('click', handleClaimTasks);

async function handleClaimTasks() {
    if (!currentUserData || !db || claimTasksButton.disabled) return;

    const todayUtc = getUtcDayTimestamp();
    let allCompletedToday = true;
    for (let i = 1; i <= 4; i++) {
         const completionField = `task${i}_completed_utc_day`;
         if (!isTodayUtc(currentUserData[completionField])) {
            allCompletedToday = false;
            break;
         }
    }
    const claimedToday = isTodayUtc(currentUserData.last_task_claim_utc_day);


    if (allCompletedToday && !claimedToday) {
        claimTasksButton.disabled = true; // Disable button during process
        showMessage('task-status-message', 'Claiming points...', false);

        const userId = String(currentUserData.telegram_user_id);
        const userRef = db.collection('users').doc(userId);
        const pointsToAward = 4 * TASK_POINTS; // 4 tasks * 30 points

        try {
             // Use a transaction for safety when updating points and status
            await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(userRef);
                if (!doc.exists) {
                     throw "Document does not exist!"; // Should not happen
                }
                const data = doc.data();

                // Double-check completion status and claimed status within the transaction
                let canClaim = true;
                 for (let i = 1; i <= 4; i++) {
                     const completionField = `task${i}_completed_utc_day`;
                     if (!isTodayUtc(data[completionField])) {
                        canClaim = false;
                        break;
                     }
                 }
                if (isTodayUtc(data.last_task_claim_utc_day)) {
                     canClaim = false; // Already claimed today
                }

                if (canClaim) {
                    const newPoints = data.points + pointsToAward;
                    transaction.update(userRef, {
                        points: newPoints,
                        last_task_claim_utc_day: firebase.firestore.FieldValue.serverTimestamp(),
                        updated_at: firebase.firestore.FieldValue.serverTimestamp()
                    });
                     // Update local data *after* transaction update
                     currentUserData.points = newPoints;
                     currentUserData.last_task_claim_utc_day = new Date(); // Approximate local update
                } else {
                     // This case should be prevented by button disabled state, but handle defensively
                    throw "Tasks not completed for today or already claimed.";
                }
            });

             updatePointsUI(currentUserData.points);
            updateTaskUI(); // Update UI state (button will become disabled, status message changes)
            showMessage('task-status-message', `✅ ${pointsToAward} points claimed!`, true, true);

        } catch (error) {
            console.error("Error claiming task points:", error);
             showMessage('task-status-message', `Error claiming points: ${error.message}`, true);
            claimTasksButton.disabled = false; // Re-enable button on error
        }

    } else {
        // Should be disabled by updateTaskUI, but handle defensively
         showMessage('task-status-message', claimedToday ? "Daily task points already claimed." : "Complete all tasks first.", claimedToday ? false : true);
    }
}


// --- Watch Ads Section Logic ---
const watchAdButton = document.getElementById('watch-ad-button');
const adsLeftSpan = document.getElementById('ads-left');
const adCooldownMessage = document.getElementById('ad-cooldown-message');
const adMessage = document.getElementById('ad-message');
let lastAdTimestamp = 0; // Keep track of the last ad watch time locally

function updateAdsUI() {
     if (!currentUserData) return;
     adsLeftSpan.textContent = `${currentUserData.daily_ads_watched_count}`; // Display count of ads watched

     const now = Date.now(); // Current time in milliseconds
     lastAdTimestamp = typeof currentUserData.last_ad_watch_utc.toMillis === 'function' ? currentUserData.last_ad_watch_utc.toMillis() : (currentUserData.last_ad_watch_utc ? new Date(currentUserData.last_ad_watch_utc).getTime() : 0);
     const timeSinceLastAd = (now - lastAdTimestamp) / 1000; // Seconds

    const canWatch = currentUserData.daily_ads_watched_count < MAX_DAILY_ADS && timeSinceLastAd >= AD_COOLDOWN_SECONDS;

    watchAdButton.disabled = !canWatch;

    if (currentUserData.daily_ads_watched_count >= MAX_DAILY_ADS) {
         watchAdButton.textContent = "Daily Ad Limit Reached";
         showMessage('ad-message', "You've watched the maximum number of ads for today.", false);
         clearMessage('ad-cooldown-message');
    } else if (timeSinceLastAd < AD_COOLDOWN_SECONDS) {
         watchAdButton.textContent = "Cooldown Active";
         const remaining = Math.ceil(AD_COOLDOWN_SECONDS - timeSinceLastAd);
         showMessage('ad-cooldown-message', `Cooldown: ${remaining}s`, false);
         clearMessage('ad-message');
         startAdCooldownTimer(remaining); // Start/update cooldown timer display
    } else {
         watchAdButton.textContent = "Watch Ad & Earn 18 Points";
         clearMessage('ad-cooldown-message');
         clearMessage('ad-message');
    }
}

function startAdCooldownTimer(seconds) {
    if (adCooldownTimer) clearInterval(adCooldownTimer); // Clear any existing timer

    let remaining = seconds;
    adCooldownMessage.textContent = `Cooldown: ${remaining}s`;

    adCooldownTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(adCooldownTimer);
            adCooldownTimer = null;
            updateAdsUI(); // Re-evaluate button state
        } else {
            adCooldownMessage.textContent = `Cooldown: ${remaining}s`;
        }
    }, 1000);
}


watchAdButton.addEventListener('click', handleWatchAd);

async function handleWatchAd() {
     if (!currentUserData || !db || watchAdButton.disabled) return;

    const now = Date.now();
    lastAdTimestamp = typeof currentUserData.last_ad_watch_utc.toMillis === 'function' ? currentUserData.last_ad_watch_utc.toMillis() : (currentUserData.last_ad_watch_utc ? new Date(currentUserData.last_ad_watch_utc).getTime() : 0);
    const timeSinceLastAd = (now - lastAdTimestamp) / 1000;

     // Re-check limits and cooldown before showing ad
     if (currentUserData.daily_ads_watched_count >= MAX_DAILY_ADS || timeSinceLastAd < AD_COOLDOWN_SECONDS) {
         updateAdsUI(); // Update UI state
         return; // Exit if limits are hit
     }

    watchAdButton.disabled = true; // Disable button during ad
    showMessage('ad-message', 'Loading ad...', false);
    clearMessage('ad-cooldown-message');


    // Monetag Rewarded Interstitial Code
    if (typeof show_9342950 === 'function') {
        show_9342950().then(() => {
            console.log('Ad shown successfully. Rewarding user.');
            // Ad watched successfully, now reward points and update counts/cooldown

            const userId = String(currentUserData.telegram_user_id);
            const userRef = db.collection('users').doc(userId);
            const pointsEarned = 18;

            db.runTransaction(async (transaction) => {
                const doc = await transaction.get(userRef);
                if (!doc.exists) {
                     throw "Document does not exist!";
                }
                 const data = doc.data();

                // Double check limits within transaction (basic check, backend verification is needed for real security)
                if (data.daily_ads_watched_count < MAX_DAILY_ADS) {
                     const newAdsWatchedCount = data.daily_ads_watched_count + 1;
                     const newPoints = data.points + pointsEarned;

                    transaction.update(userRef, {
                        daily_ads_watched_count: newAdsWatchedCount,
                        points: newPoints,
                        last_ad_watch_utc: firebase.firestore.FieldValue.serverTimestamp(), // Record ad watch time
                        updated_at: firebase.firestore.FieldValue.serverTimestamp()
                    });

                    // Update local data after transaction update
                     currentUserData.daily_ads_watched_count = newAdsWatchedCount;
                     currentUserData.points = newPoints;
                     currentUserData.last_ad_watch_utc = new Date(); // Approximate local update

                } else {
                    throw "Daily ad limit already reached."; // Should be caught by initial check and button state
                }
            })
            .then(() => {
                updatePointsUI(currentUserData.points); // Update header points
                updateAdsUI(); // Update ad section UI (count, cooldown, button state)
                 showMessage('ad-message', `✅ You earned ${pointsEarned} points!`, true, true); // Use success style

            })
            .catch(error => {
                console.error("Error updating user data after watching ad:", error);
                 showMessage('ad-message', `Error rewarding points: ${error.message}`, true);
                 watchAdButton.disabled = false; // Re-enable button on error
            });

        }).catch(error => {
            // Ad failed to load or user closed it without completing
            console.error('Monetag ad failed or incomplete:', error);
             showMessage('ad-message', 'Could not show ad. Please try again.', true);
            watchAdButton.disabled = false; // Re-enable button
             updateAdsUI(); // Update UI to show cooldown if needed
        });
    } else {
         console.error("Monetag SDK function show_9342950 not found.");
         showMessage('ad-message', 'Ad service not available.', true);
         watchAdButton.disabled = false;
         updateAdsUI();
    }
}


// --- Referral Section Logic ---
const yourReferralCodeSpan = document.getElementById('your-referral-code');
const enterReferralArea = document.getElementById('enter-referral-area');
const referralInput = document.getElementById('referral-input');
const submitReferralButton = document.getElementById('submit-referral-button');
const referralMessage = document.getElementById('referral-message');

function updateReferralUI() {
     if (!currentUserData) return;

     yourReferralCodeSpan.textContent = currentUserData.referral_code;

    if (currentUserData.referral_code_used) {
        enterReferralArea.style.display = 'none';
        showMessage('referral-status-message', 'You have already used a referral code.', false);
    } else {
        enterReferralArea.style.display = 'block';
         clearMessage('referral-status-message');
    }
}

submitReferralButton.addEventListener('click', () => {
    const code = referralInput.value.trim();
    if (code) {
        handleSubmitReferral(code);
    } else {
        showMessage('referral-message', 'Please enter a referral code.', true);
    }
});


async function handleSubmitReferral(referralCode) {
    if (!currentUserData || !db || currentUserData.referral_code_used || submitReferralButton.disabled) return;

    if (!referralCode || referralCode === '') {
        showMessage('referral-message', 'Referral code cannot be empty.', true);
        return;
    }

    if (referralCode === currentUserData.referral_code) {
        showMessage('referral-message', 'You cannot use your own referral code.', true);
        return;
    }

    submitReferralButton.disabled = true;
    showMessage('referral-message', 'Checking code...', false);

    try {
        // Find the referrer user by the code
        const referrersSnapshot = await db.collection('users')
                                          .where('referral_code', '==', referralCode)
                                          .limit(1)
                                          .get();

        if (referrersSnapshot.empty) {
            showMessage('referral-message', 'Invalid referral code.', true);
            submitReferralButton.disabled = false;
            return;
        }

        const referrerDoc = referrersSnapshot.docs[0];
        const referrerData = referrerDoc.data();

        // Ensure the referrer is not the current user (double check)
        if (referrerData.telegram_user_id === currentUserData.telegram_user_id) {
             showMessage('referral-message', 'You cannot use your own referral code.', true);
             submitReferralButton.disabled = false;
             return;
        }

        // --- Update both users in a transaction ---
        const userId = String(currentUserData.telegram_user_id);
        const userRef = db.collection('users').doc(userId);
        const referrerRef = db.collection('users').doc(String(referrerData.telegram_user_id));

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const referrerDocInTx = await transaction.get(referrerRef); // Get referrer doc within transaction

            if (!userDoc.exists || !referrerDocInTx.exists) {
                throw "User or Referrer document does not exist!";
            }

            const userData = userDoc.data();
            const referrerDataInTx = referrerDocInTx.data();

            // Final check in transaction: Has the user already used a code?
            if (userData.referral_code_used) {
                throw "You have already used a referral code.";
            }

            // Update referred user (current user)
            const newPointsUser = userData.points + REFERRED_BONUS;
            transaction.update(userRef, {
                points: newPointsUser,
                referred_by_user_id: referrerData.telegram_user_id,
                referral_code_used: true,
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Update referrer user
            const newPointsReferrer = referrerDataInTx.points + REFERRER_BONUS;
            const newReferralsCount = referrerDataInTx.referrals_count + 1;
            transaction.update(referrerRef, {
                points: newPointsReferrer,
                referrals_count: newReferralsCount,
                updated_at: firebase.firestore.FieldValue.serverTimestamp() // Update referrer's timestamp too
            });

             // Update local user data AFTER successful transaction
             currentUserData.points = newPointsUser;
             currentUserData.referred_by_user_id = referrerData.telegram_user_id;
             currentUserData.referral_code_used = true;
             // Note: currentUserData does NOT track the referrer's data changes

        });

        // Transaction successful
        updatePointsUI(currentUserData.points); // Update current user's points in header
        updateReferralUI(); // Hide the input area
        // Update profile section referral count - requires fetching referrer's updated data or relying on a full refresh
         // For simplicity, let's just update the current user's local referral count to show the effect if they refer someone later
         // Or prompt them to check their profile - accurate referrer count is on the referrer's profile.
        showMessage('referral-message', `✅ Referral code applied! You got ${REFERRED_BONUS} points. Your referrer got ${REFERRER_BONERUS} points.`, true, true);


    } catch (error) {
        console.error("Error applying referral code:", error);
        if (typeof error === 'string') {
             showMessage('referral-message', error, true); // Display specific error thrown in transaction
        } else {
            showMessage('referral-message', `Error applying referral code: ${error.message}`, true);
        }
    } finally {
        submitReferralButton.disabled = false;
    }
}

// Copy referral code button
document.querySelectorAll('.copy-button').forEach(button => {
    button.addEventListener('click', (event) => {
        const targetId = event.target.dataset.target;
        const textToCopy = document.getElementById(targetId).textContent;

        navigator.clipboard.writeText(textToCopy).then(() => {
            // Optional: Show a temporary success message near the button
            const originalText = event.target.textContent;
            event.target.textContent = 'Copied!';
            setTimeout(() => {
                event.target.textContent = originalText;
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy: ', err);
            // Optional: Show error message
        });
    });
});


// --- Withdraw Section Logic ---
const withdrawPointsSpan = document.getElementById('withdraw-points');
const withdrawAmountInput = document.getElementById('withdraw-amount');
const withdrawMethodSelect = document.getElementById('withdraw-method');
const withdrawAddressInput = document.getElementById('withdraw-address');
const submitWithdrawalButton = document.getElementById('submit-withdrawal-button');
const withdrawMessage = document.getElementById('withdraw-message');

function updateWithdrawUI() {
    if (!currentUserData) return;
    withdrawPointsSpan.textContent = formatPoints(currentUserData.points);

     // Update withdrawal options display if needed (e.g., mark first withdrawal option)
     const withdrawalOptions = document.querySelectorAll('.withdrawal-options li');
     withdrawalOptions.forEach(li => {
         li.classList.remove('claimed'); // Remove any previous state
         if (li.dataset.once === 'true' && currentUserData.claimed_first_withdrawal) {
             li.classList.add('claimed');
             li.textContent = `${li.textContent} (CLAIMED)`;
             li.style.textDecoration = 'line-through';
             li.style.opacity = '0.7';
         }
     });

    // Add input validation listener
    checkWithdrawalFormValidity(); // Check initially
}

// Basic validation checker for the form
function checkWithdrawalFormValidity() {
    const points = parseInt(withdrawAmountInput.value, 10);
    const method = withdrawMethodSelect.value;
    const address = withdrawAddressInput.value.trim();
    const currentPoints = currentUserData ? currentUserData.points : 0;

    let isValid = true;
    let message = '';

    if (isNaN(points) || points <= 0) {
        isValid = false;
        message = 'Please enter a valid points amount.';
    } else if (points > currentPoints) {
        isValid = false;
        message = 'You do not have enough points.';
    } else if (method === '') {
         isValid = false;
        message = 'Please select a withdrawal method.';
    } else if (address === '') {
         isValid = false;
        message = 'Please enter your wallet address or Pay ID.';
    } else {
         // Check against minimums and one-time rule
         let minMatch = false;
         let isFirstTimeOption = false;

         document.querySelectorAll('.withdrawal-options li').forEach(li => {
              const optionPoints = parseInt(li.dataset.points, 10);
              const isOnce = li.dataset.once === 'true';

              if (points === optionPoints) {
                  minMatch = true;
                  if (isOnce) isFirstTimeOption = true;
              }
         });

         if (!minMatch) {
             isValid = false;
              message = 'Please enter one of the exact points amounts listed.';
         } else if (isFirstTimeOption && currentUserData.claimed_first_withdrawal) {
             isValid = false;
              message = 'The $0.10 option has already been claimed.';
         }
          // Add a general check for minimum overall if not matched exactly
         if (isValid && points < FIRST_WITHDRAWAL_MIN) {
              isValid = false;
              message = `Minimum withdrawal is ${FIRST_WITHDRAWAL_MIN} points.`;
         }
    }


    submitWithdrawalButton.disabled = !isValid;
    if (!isValid && message) {
        showMessage('withdraw-message', message, true);
    } else {
        clearMessage('withdraw-message');
    }
}

// Listen for input changes to validate
withdrawAmountInput.addEventListener('input', checkWithdrawalFormValidity);
withdrawMethodSelect.addEventListener('change', checkWithdrawalFormValidity);
withdrawAddressInput.addEventListener('input', checkWithdrawalFormValidity);


submitWithdrawalButton.addEventListener('click', handleSubmitWithdrawal);

async function handleSubmitWithdrawal() {
    if (!currentUserData || !db || submitWithdrawalButton.disabled) return;

    const pointsToWithdraw = parseInt(withdrawAmountInput.value, 10);
    const method = withdrawMethodSelect.value;
    const address = withdrawAddressInput.value.trim();

    // Re-validate just before submitting
     checkWithdrawalFormValidity();
     if (submitWithdrawalButton.disabled) {
         console.warn("Attempted to submit invalid withdrawal.");
         return; // Should be disabled, but double-check
     }

    const userId = String(currentUserData.telegram_user_id);
    const userRef = db.collection('users').doc(userId);

     // Determine if this is the one-time withdrawal option
     let isFirstTimeOption = false;
     document.querySelectorAll('.withdrawal-options li').forEach(li => {
         if (parseInt(li.dataset.points, 10) === pointsToWithdraw && li.dataset.once === 'true') {
             isFirstTimeOption = true;
         }
     });


    submitWithdrawalButton.disabled = true;
    showMessage('withdraw-message', 'Submitting withdrawal request...', false);

    try {
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw "User document does not exist!";
            }
            const data = userDoc.data();

            // Final validation within transaction
             checkWithdrawalFormValidity(); // This updates the button state, but won't stop the transaction unless we throw
             if (pointsToWithdraw > data.points || (isFirstTimeOption && data.claimed_first_withdrawal)) {
                 throw "Validation failed during transaction. Points mismatch or first withdrawal already claimed.";
             }

            // Decrement points
            const newPoints = data.points - pointsToWithdraw;
            transaction.update(userRef, {
                points: newPoints,
                claimed_first_withdrawal: data.claimed_first_withdrawal || isFirstTimeOption, // Mark if this was the first-time option
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Add withdrawal record
            const withdrawalsRef = db.collection('withdrawals');
            transaction.set(withdrawalsRef.doc(), { // Use auto-generated ID
                telegram_user_id: userId,
                telegram_username: data.telegram_username, // Store username for easier management
                points_withdrawn: pointsToWithdraw,
                method: method,
                address_or_id: address,
                status: 'pending',
                withdrawal_timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            });

             // Update local user data AFTER successful transaction
            currentUserData.points = newPoints;
             currentUserData.claimed_first_withdrawal = data.claimed_first_withdrawal || isFirstTimeOption;

        });

        // Transaction successful
        updatePointsUI(currentUserData.points); // Update header points
        updateWithdrawUI(); // Update withdrawal UI (points, claimed status)
        withdrawAmountInput.value = ''; // Clear form
        withdrawMethodSelect.value = '';
        withdrawAddressInput.value = '';
        showMessage('withdraw-message', '✅ Withdrawal request submitted successfully!', true, true);

    } catch (error) {
        console.error("Error submitting withdrawal:", error);
         if (typeof error === 'string') {
             showMessage('withdraw-message', error, true); // Display specific error thrown in transaction
         } else {
            showMessage('withdraw-message', `Error submitting withdrawal: ${error.message}`, true);
         }
        submitWithdrawalButton.disabled = false; // Re-enable button on error
    }
}


// --- Initialize App on Telegram WebApp Ready ---
Telegram.WebApp.ready();
Telegram.WebApp.expand(); // Expand the WebApp to full screen

// Hide main app content initially, show loading screen
document.querySelector('.app-container').style.display = 'flex'; // Show container but loading covers
document.getElementById('loading-screen').style.display = 'flex';

Telegram.WebApp.onEvent('mainButtonPress', function() {
    // Example: Handle Main Button if needed, though bottom nav is used
    // Telegram.WebApp.showAlert('Main Button pressed!');
});

// Wait for WebApp data to be available and document to be ready
document.addEventListener('DOMContentLoaded', () => {
     // Ensure Telegram WebApp is ready before attempting to get user data
    if (Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
         initializeFirebaseAndUser();
     } else {
         // Handle cases where WebApp init data is not immediately available,
         // though Telegram.WebApp.ready() should ensure this listener fires after init
         console.warn("Telegram WebApp initDataUnsafe or user not available on DOMContentLoaded. Waiting for WebApp.ready().");
         // Re-call initialization after a short delay or rely purely on the Telegran.WebApp.ready() event if a listener was attached earlier.
         // The Telegram.WebApp.ready() listener above should catch this.
     }
});

// Fallback/alternative trigger if DOMContentLoaded happens before WebApp.ready (less common)
// This should ideally be handled by Telegram.WebApp.ready() listener firing AFTER init.
// If you uncomment this, be careful about double initialization.
/*
if (document.readyState === 'complete' || document.readyState === 'interactive') {
     if (Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
         // initializeFirebaseAndUser(); // Potentially causes double init if DOMContentLoaded also triggers
     }
}
*/

// --- Animation Handling (Button Glow Pulse) ---
// Add event listeners to trigger glow pulse on button click
document.querySelectorAll('.action-button, .task-button, .copy-button').forEach(button => {
    button.addEventListener('click', function() {
        // Remove existing animation class first to allow re-triggering
        this.classList.remove('button-glow-pulse-red', 'button-glow-pulse-blue');

        // Add appropriate glow pulse class based on button type or section
        if (this.id === 'spin-button') {
             this.classList.add('button-glow-pulse-red'); // Spin button red glow
        } else if (this.classList.contains('task-button') || this.id === 'claim-tasks-button') {
            // Tasks might use blue or green depending on status, let's use blue for click
             this.classList.add('button-glow-pulse-blue');
        }
        else if (this.id === 'watch-ad-button') {
             this.classList.add('button-glow-pulse-blue'); // Watch Ad button blue glow
        }
         else if (this.id === 'submit-referral-button' || this.classList.contains('copy-button')) {
             this.classList.add('button-glow-pulse-blue'); // Referral blue glow
         }
         else if (this.id === 'submit-withdrawal-button') {
              this.classList.add('button-glow-pulse-red'); // Withdraw red glow
         }
        // You might need to adjust which glow applies based on context if buttons change appearance/function

        // Remove the animation class after it completes (optional, if you want it to pulse only once per click)
        // This is handled better by CSS, but JS can force re-start if needed.
        // Let CSS handle the active/hover states and potentially persistent glows (like spin button)
         // For the pulse effect, let's rely on adding the class and letting CSS keyframes handle it.
    });
});


// --- Section Transition Animation (CSS handles translateY/opacity) ---
// The CSS classes `app-section` and `app-section.active` handle the transition.
// When `showSection` changes the `active` class, the CSS transitions take effect.