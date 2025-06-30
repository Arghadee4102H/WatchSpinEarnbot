// script.js

// --- Global Variables ---
let telegramUser = null;
let db = null;
let currentUserData = null; // Store current user data from Firestore
let adCooldownInterval = null; // Renamed from adCooldownTimer for clarity
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

// Get start of UTC day timestamp in milliseconds
function getUtcDayTimestamp() {
    const now = new Date();
    // Use UTC date components to create a date object at the start of the UTC day
    const utcDayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    return utcDayStart.getTime(); // Returns milliseconds since epoch for UTC day start
}

// Check if timestamp (Firestore Timestamp or JS Date or milliseconds) is for today's UTC day
function isTodayUtc(timestamp) {
    if (!timestamp) return false;
    const todayUtcMillis = getUtcDayTimestamp();
    // Convert various timestamp types to milliseconds since epoch
    let timestampMillis;
    if (typeof timestamp.toMillis === 'function') {
        timestampMillis = timestamp.toMillis(); // Firestore Timestamp
    } else if (timestamp instanceof Date) {
        timestampMillis = timestamp.getTime(); // JS Date object
    } else if (typeof timestamp === 'number') {
        timestampMillis = timestamp; // Raw milliseconds
    } else {
        return false; // Unrecognized type
    }

    const itemDate = new Date(timestampMillis);
    // Ensure the date is valid before trying to get UTC components
    if (isNaN(itemDate.getTime())) return false;

    const itemUtcDayStart = new Date(Date.UTC(itemDate.getUTCFullYear(), itemDate.getUTCMonth(), itemDate.getUTCDate(), 0, 0, 0, 0));
    return itemUtcDayStart.getTime() === todayUtcMillis;
}


// Format points with commas
function formatPoints(points) {
    // Ensure points is a number before formatting
    const numPoints = typeof points === 'number' ? points : 0;
    return numPoints.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Update UI elements that display points
function updatePointsUI(points) {
    const formattedPoints = formatPoints(points);
    document.getElementById('header-points').textContent = formattedPoints;
    // Update points in Profile and Withdraw sections if visible/needed
    // Check if sections are currently active to avoid updating hidden elements unnecessarily
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
        // initDataUnsafe might be an empty object if opened directly in browser,
        // or populated if opened via a Telegram WebApp link.
        if (Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
            telegramUser = Telegram.WebApp.initDataUnsafe.user;
            console.log("Telegram User Data:", telegramUser);

            const userId = String(telegramUser.id); // Ensure userId is a string for Firestore doc ID
            const username = telegramUser.username || `user${userId}`; // Use ID if no username
            const firstName = telegramUser.first_name || '';
            const lastName = telegramUser.last_name || '';
            const fullName = `${firstName} ${lastName}`.trim();
            // Telegram provides photo_url, but it's temporary. Using a placeholder is safer if not storing photos server-side.
            // For this example, we'll use the provided URL if available, fallback to placeholder.
            const photoUrl = telegramUser.photo_url || 'placeholder.png';

            const userRef = db.collection('users').doc(userId);

            // Try to get user document
            let userDoc;
            try {
                 userDoc = await userRef.get();
            } catch (readError) {
                 console.error("Error reading user document:", readError);
                 // If read fails with permissions error on a potentially non-existent doc,
                 // we'll assume it might be a new user and try to create.
                 // A 'not-found' error is the standard way Firestore indicates doc absence,
                 // but 'permission-denied' could happen if rules are very strict initially.
                 if (readError.code === 'permission-denied' || readError.code === 'not-found') {
                     console.warn(`Read failed (${readError.code}), assuming potential new user or rule issue. Attempting to create.`);
                     userDoc = { exists: false }; // Simulate doc not existing for creation flow
                 } else {
                     throw readError; // Re-throw other read errors
                 }
            }


            if (!userDoc.exists) {
                console.log("New user! Creating profile.");
                // New user: Prepare data for creation
                currentUserData = {
                    telegram_user_id: telegramUser.id, // Store as number as per DB schema
                    telegram_username: username,
                    full_name: fullName,
                    photo_url: photoUrl,
                    points: 0,
                    energy: 500, // Default energy as per DB structure
                    max_energy: 500, // Default max energy
                    referral_code: `A${username}`, // Generate code (basic implementation)
                    referred_by_user_id: null, // No referrer initially
                    referral_code_used: false, // Has not used a code
                    referrals_count: 0,
                    last_spin_utc_day: new Date(0), // Epoch start for initial reset check
                    daily_spins_left: DAILY_FREE_SPINS,
                    daily_ad_spins_left: DAILY_AD_SPINS,
                    last_ad_watch_utc: new Date(0), // Epoch start for initial cooldown check
                    daily_ads_watched_count: 0,
                    last_task_claim_utc_day: new Date(0), // Epoch start for initial reset check
                    task1_completed_utc_day: null,
                    task2_completed_utc_day: null,
                    task3_completed_utc_day: null,
                    task4_completed_utc_day: null,
                    claimed_first_withdrawal: false,
                    created_at: firebase.firestore.FieldValue.serverTimestamp(),
                    updated_at: firebase.firestore.FieldValue.serverTimestamp(),
                };
                 try {
                    // Use set with merge: true if there's a chance a partial doc exists,
                    // but for a new user, simple set is fine and enforces initial structure via rules.
                    await userRef.set(currentUserData);
                    console.log("User profile creation request sent.");
                     // To ensure we have server timestamps, ideally we re-fetch or use a Cloud Function to create.
                     // For this client-side only example, we'll update local data and then maybe re-fetch.
                     // A small delay and re-fetch ensures local data reflects the server timestamped fields.
                     await new Promise(resolve => setTimeout(resolve, 500)); // Wait a bit
                    const newUserDoc = await userRef.get(); // Re-fetch the document
                    if(newUserDoc.exists) {
                        currentUserData = newUserDoc.data();
                        console.log("User profile loaded after creation:", currentUserData);
                    } else {
                         console.warn("Failed to load user document immediately after creation. Local data may lack accurate server timestamps.");
                         // Continue with locally created data, timestamps might be client-side Date objects
                    }


                 } catch (setError) {
                    console.error("Error creating user profile:", setError);
                    throw new Error(`Failed to create user profile: ${setError.message}`); // Throw a user-friendly error
                 }


                 // Check for deep-linked referral code *after* user creation and data load
                 if (Telegram.WebApp.initDataUnsafe.start_param) {
                     const refCode = Telegram.WebApp.initDataUnsafe.start_param;
                      console.log("Detected start_param:", refCode);
                      // Automatically attempt to apply referral code if valid
                      // Add a small delay to ensure user data is fully set before applying referral
                     setTimeout(() => handleSubmitReferral(refCode), 1500); // Slightly longer delay
                 }


            } else {
                // Existing user: Load data
                currentUserData = userDoc.data();
                console.log("Existing user loaded:", currentUserData);
                // Update username/name/photo if they changed in Telegram
                 const updateData = {};
                 let needsUpdate = false;

                 // Check if Telegram data is different from stored data
                 if (currentUserData.telegram_username !== username) {
                      updateData.telegram_username = username;
                      needsUpdate = true;
                 }
                 // Note: Full name is derived, might not need storage if first/last are available
                 // if (currentUserData.full_name !== fullName) {
                 //     updateData.full_name = fullName;
                 //      needsUpdate = true;
                 // }
                 // Update photo URL if it changed and is not the default placeholder
                 if (photoUrl !== 'placeholder.png' && currentUserData.photo_url !== photoUrl) {
                      updateData.photo_url = photoUrl;
                       needsUpdate = true;
                 }

                 if(needsUpdate) {
                      console.log("Updating user data in Firestore:", updateData);
                     try {
                         updateData.updated_at = firebase.firestore.FieldValue.serverTimestamp();
                         await userRef.update(updateData);
                         console.log("User data updated successfully.");
                         // Update local data after successful DB update
                         currentUserData = { ...currentUserData, ...updateData }; // Merge updates into local copy
                         currentUserData.updated_at = new Date(); // Approximate local update time
                     } catch (updateError) {
                         console.error("Error updating user data:", updateError);
                         // Continue with potentially slightly outdated data, don't block app load
                         // The next app load or UI refresh should pick up the correct data.
                     }
                 }
            }

            // Perform daily resets after loading/creating user data
            // This function will check timestamps and update DB if necessary
            // We wait for this as it affects UI state (spins, tasks, ads)
            await performDailyResets(); // Wait for resets before updating UI

            // Update UI with user data (will reflect any resets that happened)
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
                Telegram.WebApp.expand(); // Expand the WebApp to full screen
                 // Optional: Give haptic feedback if supported
                 if(Telegram.WebApp.HapticFeedback) {
                     Telegram.WebApp.HapticFeedback.impactOccurred('light');
                 }
            }, 300);

        } else {
             // This case happens if initDataUnsafe or user is missing, likely opened outside Telegram
            console.error("Telegram WebApp initDataUnsafe or user data not available. Cannot initialize app.");
            document.getElementById('loading-screen').innerHTML = '<p class="message error">Error: Could not get Telegram user data. Please open the app from a Telegram bot or channel link.</p>';
             Telegram.WebApp.ready(); // Still call ready even if initialization failed
             // Telegram.WebApp.showAlert('Error: Could not get Telegram user data. Please open the WebApp from a Telegram bot or channel link.'); // Avoid multiple alerts on load
        }

    } catch (error) {
        // Catch any unhandled errors during the initialization process
        console.error("Fatal Error during app initialization:", error);
        document.getElementById('loading-screen').innerHTML = `<p class="message error">${error.message || 'An unexpected error occurred during initialization.'}</p>`;
         Telegram.WebApp.ready(); // Still call ready
         Telegram.WebApp.showAlert(`App initialization failed: ${error.message || 'An unexpected error occurred.'}`);
    }
}

// Update header display
function updateHeaderUI() {
     if (currentUserData) {
         // Use the stored photo_url, defaulting to placeholder if none
         document.getElementById('header-user-photo').src = currentUserData.photo_url || 'placeholder.png';
         document.getElementById('header-username').textContent = currentUserData.telegram_username;
         updatePointsUI(currentUserData.points); // Update header points specifically
     } else {
         // Reset header if user data is not available
         document.getElementById('header-user-photo').src = 'placeholder.png';
         document.getElementById('header-username').textContent = 'Guest';
         document.getElementById('header-points').textContent = '0';
     }
}

// Update profile section display
function updateProfileUI() {
    if (currentUserData) {
        // Use the stored photo_url, defaulting to placeholder if none
        document.getElementById('profile-user-photo').src = currentUserData.photo_url || 'placeholder.png';
        document.getElementById('profile-username').textContent = currentUserData.telegram_username;
        // Use stored full_name or construct from Telegram data if needed, depending on what's saved
        document.getElementById('profile-full-name').textContent = currentUserData.full_name || 'N/A'; // Display stored or N/A
        document.getElementById('profile-telegram-id').textContent = currentUserData.telegram_user_id;
        document.getElementById('profile-referral-code').textContent = currentUserData.referral_code || 'Generating...';
        document.getElementById('profile-referrals-count').textContent = currentUserData.referrals_count || '0';
        document.getElementById('profile-points').textContent = formatPoints(currentUserData.points);
         // Energy display if needed
         // document.getElementById('profile-energy').textContent = currentUserData.energy || '--';
         // document.getElementById('profile-max-energy').textContent = currentUserData.max_energy || '--';
    } else {
        // Reset profile UI if user data is not loaded
         document.getElementById('profile-user-photo').src = 'placeholder.png';
         document.getElementById('profile-username').textContent = 'Loading...';
         document.getElementById('profile-full-name').textContent = 'Loading...';
         document.getElementById('profile-telegram-id').textContent = 'Loading...';
         document.getElementById('profile-referral-code').textContent = 'Loading...';
         document.getElementById('profile-referrals-count').textContent = '0';
         document.getElementById('profile-points').textContent = '0';
         // Energy reset if used
         // document.getElementById('profile-energy').textContent = '--';
         // document.getElementById('profile-max-energy').textContent = '--';
    }
}

// --- Daily Reset Logic ---
// This function should be called on app load and potentially periodically
async function performDailyResets() {
    if (!currentUserData || !db) return;

    const todayUtcMillis = getUtcDayTimestamp();
    const userRef = db.collection('users').doc(String(currentUserData.telegram_user_id));
    let updateData = {};
    let dataChanged = false;

    // Spins Reset
    // Convert Firestore Timestamp/Date to JS Date and get UTC day start in milliseconds
    const lastSpinDayMillis = typeof currentUserData.last_spin_utc_day?.toMillis === 'function' ?
                               new Date(currentUserData.last_spin_utc_day.toMillis()).setUTCHours(0, 0, 0, 0) :
                               (currentUserData.last_spin_utc_day instanceof Date ? currentUserData.last_spin_utc_day.setUTCHours(0, 0, 0, 0) : 0); // Handle potential null/undefined/epoch start

    if (lastSpinDayMillis !== todayUtcMillis) {
        console.log("Resetting daily spins.");
        updateData.daily_spins_left = DAILY_FREE_SPINS;
        updateData.daily_ad_spins_left = DAILY_AD_SPINS;
        // Update local copy immediately to reflect reset state in UI updates
        currentUserData.daily_spins_left = DAILY_FREE_SPINS;
        currentUserData.daily_ad_spins_left = DAILY_AD_SPINS;
        // last_spin_utc_day will be updated to server timestamp when updates are committed
        dataChanged = true;
    }

    // Ads Reset
     const lastAdDayMillis = typeof currentUserData.last_ad_watch_utc?.toMillis === 'function' ?
                               new Date(currentUserData.last_ad_watch_utc.toMillis()).setUTCHours(0, 0, 0, 0) :
                               (currentUserData.last_ad_watch_utc instanceof Date ? currentUserData.last_ad_watch_utc.setUTCHours(0, 0, 0, 0) : 0); // Handle potential null/undefined/epoch start


    if (lastAdDayMillis !== todayUtcMillis) {
        console.log("Resetting daily ads watched count.");
        updateData.daily_ads_watched_count = 0;
        // Update local copy
        currentUserData.daily_ads_watched_count = 0;
         // last_ad_watch_utc is used for cooldown, not daily reset date tracker
        dataChanged = true;
    }


    // Tasks Reset (Reset if last claim was NOT today UTC)
    // Note: Task completion fields taskX_completed_utc_day are also checked against today's UTC day in updateTaskUI
     const lastTaskClaimDayMillis = typeof currentUserData.last_task_claim_utc_day?.toMillis === 'function' ?
                                     new Date(currentUserData.last_task_claim_utc_day.toMillis()).setUTCHours(0, 0, 0, 0) :
                                     (currentUserData.last_task_claim_utc_day instanceof Date ? currentUserData.last_task_claim_utc_day.setUTCHours(0, 0, 0, 0) : 0); // Handle potential null/undefined/epoch start


    if (lastTaskClaimDayMillis !== todayUtcMillis) {
        console.log("Resetting daily tasks.");
        updateData.task1_completed_utc_day = null;
        updateData.task2_completed_utc_day = null;
        updateData.task3_completed_utc_day = null;
        updateData.task4_completed_utc_day = null;
         // Do NOT reset last_task_claim_utc_day here, it's only set WHEN claimed.
         // Update local copy
        currentUserData.task1_completed_utc_day = null;
        currentUserData.task2_completed_utc_day = null;
        currentUserData.task3_completed_utc_day = null;
        currentUserData.task4_completed_utc_day = null;
        dataChanged = true;
    }


    // Commit updates if any reset occurred
    if (dataChanged) {
        // Update reset timestamps to current server time if resets happened
        // last_spin_utc_day tracks the last day spins were reset/used, used for next reset check
        if (updateData.daily_spins_left !== undefined) { // Check if spin reset happened
             updateData.last_spin_utc_day = firebase.firestore.FieldValue.serverTimestamp();
             currentUserData.last_spin_utc_day = new Date(); // Update local approx
        }
         // last_ad_watch_utc is updated *only* when an ad is watched for cooldown purposes, not daily reset
         // last_task_claim_utc_day is updated *only* when task points are claimed, not daily reset

        updateData.updated_at = firebase.firestore.FieldValue.serverTimestamp(); // Always update main timestamp

        try {
             await userRef.update(updateData);
             console.log("Daily resets committed to Firestore.");
             // Local data for other fields were updated above (e.g., daily_spins_left)
             currentUserData.updated_at = new Date(); // Approximate local update time

        } catch (error) {
             console.error("Error during daily resets commit:", error);
             // App will proceed with potentially un-reset data for this session
             // Data inconsistency is a risk with client-side resets.
        }
    }
}


// --- Navigation ---
document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => {
        const sectionId = button.dataset.section;
        showSection(sectionId);
    });
});

// Function to show a specific section
function showSection(sectionId) {
    // Find the currently active section and the target section elements
    const activeSection = document.querySelector('.app-section.active');
    const targetSection = document.getElementById(sectionId);

    if (!activeSection || !targetSection || activeSection.id === sectionId) {
        // If no active section, target is already active, or target doesn't exist, just update nav
        document.querySelectorAll('.nav-item').forEach(button => {
            button.classList.remove('active');
            if (button.dataset.section === sectionId) {
                button.classList.add('active');
            }
        });
         // Update UI for the potentially already active section
        updateSectionUI(sectionId);
        return;
    }

     // Determine slide direction (optional, can enhance UX)
     // Requires knowing the order of sections. For a simple left-to-right nav:
     const sectionOrder = ['profile-section', 'spin-section', 'task-section', 'watch-ads-section', 'referral-section', 'withdraw-section'];
     const activeIndex = sectionOrder.indexOf(activeSection.id);
     const targetIndex = sectionOrder.indexOf(sectionId);
     const direction = targetIndex > activeIndex ? 'left' : 'right';

    // Apply exit animation to active section
    activeSection.style.transform = `translateX(${direction === 'left' ? '-100%' : '100%'})`;
    activeSection.style.opacity = '0';
    activeSection.classList.remove('active'); // Remove active class immediately to hide

    // Prepare target section for entrance animation
    targetSection.style.transform = `translateX(${direction === 'left' ? '100%' : '-100%'})`;
    targetSection.style.opacity = '0';
    targetSection.style.display = 'block'; // Make it block but off-screen

    // Use a timeout to wait for the active section to start animating out
    setTimeout(() => {
        // Apply entrance animation to target section
        targetSection.style.transform = 'translateX(0)';
        targetSection.style.opacity = '1';
        targetSection.classList.add('active'); // Add active class after starting animation

        // Hide the old section completely after its animation is done
        setTimeout(() => {
             activeSection.style.display = 'none';
              // Reset transform on hidden section so it's ready if navigated back
              activeSection.style.transform = 'translateX(0)';
        }, 300); // Match CSS transition duration (0.3s)


         // Update navigation buttons
        document.querySelectorAll('.nav-item').forEach(button => {
            button.classList.remove('active');
            if (button.dataset.section === sectionId) {
                button.classList.add('active');
            }
        });

        // Update section-specific UI after transition
        updateSectionUI(sectionId);


    }, 50); // Small delay before starting the entrance animation
}

// Centralized function to update UI for a given section
function updateSectionUI(sectionId) {
     // Fetch fresh data before updating UI, especially when switching sections
     fetchUserData().then(() => {
         console.log(`Updating UI for section: ${sectionId}`);
         switch (sectionId) {
             case 'profile-section':
                 updateProfileUI();
                 break;
             case 'spin-section':
                 updateSpinUI();
                 break;
             case 'task-section':
                 updateTaskUI();
                 break;
             case 'watch-ads-section':
                 updateAdsUI();
                 break;
             case 'referral-section':
                 updateReferralUI();
                 break;
             case 'withdraw-section':
                 updateWithdrawUI();
                 break;
         }
     }).catch(error => {
         console.error("Error fetching user data during section switch:", error);
         // Display a generic error message if fetching fails
         showMessage(`${sectionId.replace('-section', '')}-message`, `Error loading data: ${error.message}`, true);
     });
}

// Helper function to fetch the latest user data
async function fetchUserData() {
    if (!currentUserData || !db) return;
    const userId = String(currentUserData.telegram_user_id);
    const userRef = db.collection('users').doc(userId);
    try {
        const userDoc = await userRef.get();
        if (userDoc.exists) {
            currentUserData = userDoc.data();
            console.log("Fetched latest user data.");
            await performDailyResets(); // Perform resets based on fresh data
        } else {
            console.error("User document not found during data fetch.");
            // Potentially reset currentUserData or show a critical error
            // currentUserData = null; // Or handle as appropriate
        }
    } catch (error) {
        console.error("Error fetching user data:", error);
        throw error; // Re-throw to be caught by calling function
    }
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
             spinButton.classList.add('button-glow-pulse-red'); // Add spin glow (CSS handles animation)
            clearMessage('spin-message');
        } else if (currentUserData.daily_ad_spins_left > 0) {
             spinButton.textContent = `Watch Ad for 2 Spins (${currentUserData.daily_ad_spins_left} left)`; // Show remaining ad spins
            spinButton.disabled = false; // Enable button to watch ad
             spinButton.classList.remove('button-glow-pulse-red'); // Stop spin glow
             spinButton.classList.add('button-glow-pulse-blue'); // Add ad glow (CSS handles animation)
            showMessage('spin-message', "You're out of free spins. Watch an ad to get 2 more!", false); // Not an error, just info
        }
        else {
            spinButton.textContent = "No Spins Left Today";
            spinButton.disabled = true;
             spinButton.classList.remove('button-glow-pulse-red', 'button-glow-pulse-blue'); // Stop glows
            showMessage('spin-message', "You've used all your spins and ad-spins for today. Check back tomorrow!", false); // Info message
        }
    } else {
         spinButton.disabled = true; // Disable if user data not loaded
         spinButton.textContent = "Loading...";
         spinsLeftSpan.textContent = '--';
         adSpinsLeftSpan.textContent = '--';
         showMessage('spin-message', 'Loading user data...', false);
    }
}

spinButton.addEventListener('click', handleSpin);

async function handleSpin() {
    if (!currentUserData || !db || spinButton.disabled) {
         if (!currentUserData) showMessage('spin-message', 'User data not loaded.', true);
         return;
    }
    clearMessage('spin-message');
    spinButton.disabled = true; // Prevent double clicking
    spinButton.classList.remove('button-glow-pulse-red', 'button-glow-pulse-blue'); // Stop pulsing during action


    // Re-fetch data to ensure it's fresh before attempting state change
     try {
         const userDoc = await db.collection('users').doc(String(currentUserData.telegram_user_id)).get();
         if (!userDoc.exists) throw new Error("User data not found during spin attempt.");
         currentUserData = userDoc.data(); // Update local copy with latest data
         // Perform daily resets *again* based on fresh data, just in case state changed externally
         await performDailyResets(); // Wait for resets
         updateSpinUI(); // Update UI based on fresh data & potential resets

         // Check if the action is still valid after re-fetching and resetting
         if (currentUserData.daily_spins_left <= 0 && currentUserData.daily_ad_spins_left <= 0) {
             showMessage('spin-message', 'No spins left after checking.', false);
             spinButton.disabled = true;
             return; // Exit if no spins left
         }

     } catch(error) {
          console.error("Error fetching user data before spin:", error);
          showMessage('spin-message', `Error loading user data: ${error.message}`, true);
          spinButton.disabled = false; // Re-enable
          updateSpinUI(); // Revert UI state
          return;
     }


    if (currentUserData.daily_spins_left > 0) {
        // --- Handle Free Spin ---
        const pointsEarned = Math.random() < 0.8 ?
                           Math.floor(Math.random() * (15 - 2 + 1)) + 2 : // 80% chance: 2-15 points
                           Math.floor(Math.random() * (25 - 16 + 1)) + 16; // 20% chance: 16-25 points

        const newSpinsLeft = currentUserData.daily_spins_left - 1;
        const newPoints = currentUserData.points + pointsEarned;

        const userRef = db.collection('users').doc(String(currentUserData.telegram_user_id));

        try {
            await userRef.update({
                daily_spins_left: newSpinsLeft,
                points: newPoints,
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            });
            currentUserData.daily_spins_left = newSpinsLeft; // Update local
            currentUserData.points = newPoints; // Update local
            updatePointsUI(newPoints); // Update header points
            updateSpinUI(); // Update spin section UI (spins left, button state)
            showMessage('spin-message', `🎉 You won ${pointsEarned} points!`, true, true); // Use success style for wins

             // Optional: Trigger Telegram haptic feedback on win
             if(Telegram.WebApp.HapticFeedback) {
                Telegram.WebApp.HapticFeedback.notificationOccurred('success');
             }

        } catch (error) {
            console.error("Error updating user data after free spin:", error);
             showMessage('spin-message', `Error spinning: ${error.message}`, true);
             // Data inconsistency is possible if the update fails client-side.
             // A full re-fetch and UI update on error is more robust.
             fetchUserData().then(updateSpinUI).catch(console.error);
        } finally {
            // spinButton.disabled is handled by updateSpinUI based on remaining spins
             updateSpinUI(); // Ensure UI is correct based on remaining spins
        }

    } else if (currentUserData.daily_ad_spins_left > 0) {
         // --- Handle Ad Spin ---
         console.log("Attempting to show ad for spins...");
         showMessage('spin-message', 'Loading ad...', false);

         // Check ad cooldown before attempting to show ad
         const now = Date.now();
         const lastAdTimestampMillis = typeof currentUserData.last_ad_watch_utc?.toMillis === 'function' ? currentUserData.last_ad_watch_utc.toMillis() : (currentUserData.last_ad_watch_utc instanceof Date ? currentUserData.last_ad_watch_utc.getTime() : 0);
         const timeSinceLastAd = (now - lastAdTimestampMillis) / 1000; // Seconds

         if (timeSinceLastAd < AD_COOLDOWN_SECONDS) {
              const remaining = Math.ceil(AD_COoldown_SECONDS - timeSinceLastAd);
              showMessage('spin-message', `Please wait ${remaining}s before watching another ad.`, false); // Info message
              spinButton.disabled = false; // Re-enable button
              updateSpinUI(); // Update UI to show cooldown
              startAdCooldownTimer(remaining); // Start timer display
              return; // Stop here
         }

         // Monetag Rewarded Interstitial Code (Assuming zone '9342950' is correct for rewarded)
         if (typeof show_9342950 === 'function') {
              // Add event listeners for ad lifecycle if Monetag SDK supports them
              // For basic implementation, we rely on the Promise resolution.
             show_9342950().then(() => {
                 // This block executes if the ad is successfully shown and completed (user action might be needed to close)
                 console.log('Monetag ad shown successfully. Rewarding user.');
                 // Ad watched successfully, now reward the user with spins

                 const userId = String(currentUserData.telegram_user_id);
                 const userRef = db.collection('users').doc(userId);
                 const bonusSpins = 2; // As per requirement

                 // Use a transaction to safely update spin counts and ad timestamp
                 db.runTransaction(async (transaction) => {
                     const doc = await transaction.get(userRef);
                     if (!doc.exists) {
                          throw new Error("User document does not exist during transaction!");
                     }
                     const data = doc.data();

                     // Double check limits within transaction
                     if (data.daily_ad_spins_left > 0) {
                         const newAdSpinsLeft = data.daily_ad_spins_left - 1;
                         const newFreeSpins = data.daily_spins_left + bonusSpins;

                         transaction.update(userRef, {
                             daily_ad_spins_left: newAdSpinsLeft,
                             daily_spins_left: newFreeSpins, // Add bonus spins to free spins count
                             last_ad_watch_utc: firebase.firestore.FieldValue.serverTimestamp(), // Record ad watch time for cooldown
                             updated_at: firebase.firestore.FieldValue.serverTimestamp()
                         });

                         // Update local data after transaction update
                          currentUserData.daily_ad_spins_left = newAdSpinsLeft;
                          currentUserData.daily_spins_left = newFreeSpins;
                          currentUserData.last_ad_watch_utc = new Date(); // Approximate local update

                     } else {
                          // Should be caught by pre-check and button state, but defensive
                         throw new Error("No ad spins left.");
                     }
                 })
                 .then(() => {
                     // Transaction successful
                     updateSpinUI(); // Update UI with new spin counts (button state changes too)
                      showMessage('spin-message', `✅ You earned ${bonusSpins} bonus spins!`, true, true); // Use success style

                      // Start cooldown timer display
                      startAdCooldownTimer(AD_COOLDOWN_SECONDS);

                      // Optional: Trigger Telegram haptic feedback on reward
                      if(Telegram.WebApp.HapticFeedback) {
                         Telegram.WebApp.HapticFeedback.notificationOccurred('success');
                      }

                 })
                 .catch(error => {
                     console.error("Error updating user data after ad spin transaction:", error);
                      showMessage('spin-message', `Error rewarding spins: ${error.message}`, true);
                      // Re-fetch data to sync UI if update failed
                      fetchUserData().then(updateSpinUI).catch(console.error);
                 })
                 .finally(() => {
                      // spinButton.disabled is handled by updateSpinUI based on remaining spins
                      updateSpinUI(); // Ensure UI is correct state
                 });

             }).catch(error => {
                 // Ad failed to load or user closed it without completing/rewarding
                 console.error('Monetag ad failed or incomplete:', error);
                 showMessage('spin-message', 'Could not show ad or ad was not completed. Please try again.', true);
                 // No reward given, re-enable button and update UI
                 spinButton.disabled = false;
                 updateSpinUI(); // Ensure UI state is correct
             });
         } else {
              console.error("Monetag SDK function show_9342950 not found. Make sure the SDK script is loaded.");
              showMessage('spin-message', 'Ad service not available.', true);
              spinButton.disabled = false;
              updateSpinUI(); // Ensure UI state is correct
         }

    } else {
        // Should be disabled by updateSpinUI, but good to double check
        showMessage('spin-message', "No spins or ad-spins left today.", false); // Info message
        spinButton.disabled = true;
         updateSpinUI(); // Ensure UI is correct
    }
}


// --- Task Section Logic ---
const claimTasksButton = document.getElementById('claim-tasks-button');
const taskStatusMessage = document.getElementById('task-status-message');
const taskButtons = document.querySelectorAll('.task-button');

function updateTaskUI() {
    if (!currentUserData) {
        claimTasksButton.disabled = true;
         showMessage('task-status-message', 'Loading tasks data...', false);
         taskButtons.forEach(btn => btn.disabled = true);
        return;
    }

    const todayUtcMillis = getUtcDayTimestamp();
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
            taskButton.disabled = false; // Enable button for uncompleted tasks
            allCompletedToday = false; // Mark as not all completed if any is pending today
        }
    }

    // Check if points were already claimed for today
    const claimedToday = isTodayUtc(currentUserData.last_task_claim_utc_day);

    if (allCompletedToday && !claimedToday) {
        claimTasksButton.disabled = false;
        claimTasksButton.textContent = `Claim Daily Task Points (120)`;
         showMessage('task-status-message', 'All tasks completed! Claim your points.', true, true); // Success style for ready to claim
    } else if (claimedToday) {
        claimTasksButton.disabled = true;
        claimTasksButton.textContent = "Points Claimed Today";
         showMessage('task-status-message', 'Daily task points already claimed.', false); // Info message
    }
    else {
        claimTasksButton.disabled = true;
        claimTasksButton.textContent = "Complete All Tasks First";
         clearMessage('task-status-message'); // Clear message if tasks are just pending/not all done
    }
}

taskButtons.forEach(button => {
    button.addEventListener('click', async (event) => {
        const taskId = event.target.dataset.taskId;
        const url = event.target.dataset.url;

        if (!currentUserData || !db) return;

        const taskButton = event.target; // Get the specific button that was clicked
        const taskElement = taskButton.closest('li');
        const taskStatusSpan = taskElement.querySelector('.task-status');

         // Disable button and update status immediately for visual feedback
         taskButton.disabled = true;
         taskStatusSpan.textContent = 'Opening...';

        // Open the link
        Telegram.WebApp.openLink(url);

        // --- Security Warning ---
        // In a real app, verification (e.g., bot checking membership) would happen here.
        // For this example, we mark it complete assuming the user will join.
        // This is INSECURE. Client-side marking can be faked.
        // A secure approach needs server-side verification (e.g., Telegram Bot API check)

        const userId = String(currentUserData.telegram_user_id);
        const userRef = db.collection('users').doc(userId);
        const completionField = `task${taskId}_completed_utc_day`;

         try {
            // Re-fetch data to ensure we don't overwrite if another device completed it
             const userDoc = await userRef.get();
             if (!userDoc.exists) throw new Error("User data not found.");
             currentUserData = userDoc.data(); // Update local copy

            // Only mark completed if it wasn't already completed today
            if (!isTodayUtc(currentUserData[completionField])) {
                 // Use server timestamp to mark completion for today UTC
                const updateData = {
                     [completionField]: firebase.firestore.FieldValue.serverTimestamp(),
                     updated_at: firebase.firestore.FieldValue.serverTimestamp()
                };
                await userRef.update(updateData);

                // Update local data after successful DB write
                 currentUserData[completionField] = new Date(); // Approximate local update time
                 console.log(`Task ${taskId} marked as completed in DB.`);

            } else {
                console.log(`Task ${taskId} was already completed today.`);
            }

            updateTaskUI(); // Re-render task UI based on updated data
             showMessage('task-status-message', `Task ${taskId} link opened. Remember to join!`, false); // Info message

         } catch (error) {
             console.error(`Error marking task ${taskId} as completed:`, error);
             showMessage('task-status-message', `Error marking task ${taskId}. Try again. ${error.message}`, true);
             // Re-enable button or revert UI state if update failed
             taskButton.disabled = false;
             taskStatusSpan.textContent = 'Pending';
              taskElement.classList.remove('completed');
         }
    });
});

claimTasksButton.addEventListener('click', handleClaimTasks);

async function handleClaimTasks() {
    if (!currentUserData || !db || claimTasksButton.disabled) {
         if (!currentUserData) showMessage('task-status-message', 'User data not loaded.', true);
         return;
    }

    // Re-fetch data to ensure task statuses and claim status are fresh
     try {
         const userDoc = await db.collection('users').doc(String(currentUserData.telegram_user_id)).get();
         if (!userDoc.exists) throw new Error("User data not found.");
         currentUserData = userDoc.data(); // Update local copy
         // Perform daily resets again, just in case
         await performDailyResets();
         updateTaskUI(); // Update UI based on fresh data & potential resets

         // Re-check conditions based on fresh data before proceeding
         const todayUtcMillis = getUtcDayTimestamp();
         let allCompletedToday = true;
         for (let i = 1; i <= 4; i++) {
             const completionField = `task${i}_completed_utc_day`;
             if (!isTodayUtc(currentUserData[completionField])) {
                allCompletedToday = false;
                break;
             }
         }
         const claimedToday = isTodayUtc(currentUserData.last_task_claim_utc_day);

         if (!allCompletedToday) {
              showMessage('task-status-message', "Not all tasks are completed for today.", true);
             updateTaskUI(); // Ensure UI reflects correct state
             return; // Exit
         }
         if (claimedToday) {
              showMessage('task-status-message', "Daily task points already claimed.", false); // Info message
              updateTaskUI(); // Ensure UI reflects correct state
              return; // Exit
         }

     } catch(error) {
         console.error("Error fetching data before claiming tasks:", error);
          showMessage('task-status-message', `Error checking task status: ${error.message}`, true);
         return;
     }


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
                 throw new Error("User document does not exist during transaction!");
            }
            const data = doc.data();

            // Final check within transaction: Task completion and claimed status
            // (This check within transaction is important for race conditions)
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
                 currentUserData.last_task_claim_utc_day = new Date(); // Approximate local update time
            } else {
                 // This case should be prevented by button disabled state and pre-check, but handle defensively
                throw new Error("Tasks not completed for today or points already claimed.");
            }
        });

        // Transaction successful
         // Update header points
        updatePointsUI(currentUserData.points);
        // Update task section UI (button will become disabled, status message changes)
        updateTaskUI();
        showMessage('task-status-message', `✅ ${pointsToAward} points claimed!`, true, true); // Success message

        // Optional: Trigger Telegram haptic feedback on claim
         if(Telegram.WebApp.HapticFeedback) {
            Telegram.WebApp.HapticFeedback.notificationOccurred('success');
         }


    } catch (error) {
        console.error("Error claiming task points:", error);
         showMessage('task-status-message', `Error claiming points: ${error.message}`, true);
        claimTasksButton.disabled = false; // Re-enable button on error
         // Re-fetch data to sync UI if update failed
         fetchUserData().then(updateTaskUI).catch(console.error);
    }
}


// --- Watch Ads Section Logic ---
const watchAdButton = document.getElementById('watch-ad-button');
const adsLeftSpan = document.getElementById('ads-left');
const adCooldownMessage = document.getElementById('ad-cooldown-message');
const adMessage = document.getElementById('ad-message');
let adCooldownIntervalId = null; // Store the interval ID to clear it

function updateAdsUI() {
     if (!currentUserData) {
         watchAdButton.disabled = true;
          showMessage('ad-message', 'Loading ad data...', false);
         adsLeftSpan.textContent = `0/38`;
         clearMessage('ad-cooldown-message');
         if (adCooldownIntervalId) clearInterval(adCooldownIntervalId); // Stop timer if user data gone
         adCooldownIntervalId = null;
         return;
     }

     // Display daily count (watched)
     adsLeftSpan.textContent = `${currentUserData.daily_ads_watched_count}/38`;

     const now = Date.now(); // Current time in milliseconds
     // Convert Firestore Timestamp/Date to JS Date and get time in milliseconds
     const lastAdTimestampMillis = typeof currentUserData.last_ad_watch_utc?.toMillis === 'function' ? currentUserData.last_ad_watch_utc.toMillis() : (currentUserData.last_ad_watch_utc instanceof Date ? currentUserData.last_ad_watch_utc.getTime() : 0);
     const timeSinceLastAd = (now - lastAdTimestampMillis) / 1000; // Seconds

    const dailyLimitReached = currentUserData.daily_ads_watched_count >= MAX_DAILY_ADS;
    const cooldownActive = timeSinceLastAd < AD_COOLDOWN_SECONDS;

    const canWatch = !dailyLimitReached && !cooldownActive;

    watchAdButton.disabled = !canWatch;

    if (dailyLimitReached) {
         watchAdButton.textContent = "Daily Ad Limit Reached";
         showMessage('ad-message', "You've watched the maximum number of ads for today.", false); // Info message
         clearMessage('ad-cooldown-message');
         if (adCooldownIntervalId) clearInterval(adCooldownIntervalId); // Stop timer
         adCooldownIntervalId = null;
    } else if (cooldownActive) {
         watchAdButton.textContent = "Cooldown Active";
         const remaining = Math.ceil(AD_COoldown_SECONDS - timeSinceLastAd);
         showMessage('ad-cooldown-message', `Cooldown: ${remaining}s`, false); // Info message
         clearMessage('ad-message');
         startAdCooldownTimer(remaining); // Start/update cooldown timer display
    } else {
         watchAdButton.textContent = "Watch Ad & Earn 18 Points";
         clearMessage('ad-cooldown-message');
         clearMessage('ad-message');
         if (adCooldownIntervalId) clearInterval(adCooldownIntervalId); // Stop timer if it somehow was running
         adCooldownIntervalId = null;
    }
}

function startAdCooldownTimer(seconds) {
    if (adCooldownIntervalId) clearInterval(adCooldownIntervalId); // Clear any existing timer

    let remaining = seconds;
    adCooldownMessage.textContent = `Cooldown: ${remaining}s`;

    adCooldownIntervalId = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(adCooldownIntervalId);
            adCooldownIntervalId = null;
            updateAdsUI(); // Re-evaluate button state and UI when cooldown ends
        } else {
            adCooldownMessage.textContent = `Cooldown: ${remaining}s`;
        }
    }, 1000);
}


watchAdButton.addEventListener('click', handleWatchAd);

async function handleWatchAd() {
     if (!currentUserData || !db || watchAdButton.disabled) {
         if (!currentUserData) showMessage('ad-message', 'User data not loaded.', true);
         // Button disabled state implies other reasons (limit/cooldown), UI updated by updateAdsUI
         return;
    }

    // Re-fetch data before showing ad to get latest counts/timestamps
     try {
         const userDoc = await db.collection('users').doc(String(currentUserData.telegram_user_id)).get();
         if (!userDoc.exists) throw new Error("User data not found during watch ad attempt.");
         currentUserData = userDoc.data(); // Update local copy
         // Perform daily resets again, just in case
         await performDailyResets();
         updateAdsUI(); // Update UI based on fresh data & potential resets

         // Final re-check limits and cooldown based on fresh data
         const now = Date.now();
         const lastAdTimestampMillis = typeof currentUserData.last_ad_watch_utc?.toMillis === 'function' ? currentUserData.last_ad_watch_utc.toMillis() : (currentUserData.last_ad_watch_utc instanceof Date ? currentUserData.last_ad_watch_utc.getTime() : 0);
         const timeSinceLastAd = (now - lastAdTimestampMillis) / 1000;

         if (currentUserData.daily_ads_watched_count >= MAX_DAILY_ADS) {
             showMessage('ad-message', 'Daily ad limit reached after checking.', false); // Info message
             updateAdsUI(); // Ensure UI state is correct
             return; // Exit if limits are hit after re-fetch
         }
         if (timeSinceLastAd < AD_COOLDOWN_SECONDS) {
              const remaining = Math.ceil(AD_COoldown_SECONDS - timeSinceLastAd);
              showMessage('ad-message', `Cooldown active (${remaining}s) after checking.`, false); // Info message
              updateAdsUI(); // Ensure UI state is correct (shows timer)
              return; // Exit if cooldown is active
         }

     } catch(error) {
         console.error("Error fetching user data before watching ad:", error);
          showMessage('ad-message', `Error loading user data: ${error.message}`, true);
         return;
     }


    watchAdButton.disabled = true; // Disable button during ad process
    showMessage('ad-message', 'Loading ad...', false);
    clearMessage('ad-cooldown-message'); // Clear cooldown message temporarily


    // Monetag Rewarded Interstitial Code (Assuming zone '9342950' is correct for rewarded)
    if (typeof show_9342950 === 'function') {
         // show_9342950().then() resolves when the ad finishes (user clicks 'x' or completes action)
        show_9342950().then(() => {
            console.log('Monetag ad shown successfully. Rewarding user.');
            // Ad watched successfully, now reward points and update counts/cooldown

            const userId = String(currentUserData.telegram_user_id);
            const userRef = db.collection('users').doc(userId);
            const pointsEarned = 18;

            db.runTransaction(async (transaction) => {
                const doc = await transaction.get(userRef);
                if (!doc.exists) {
                     throw new Error("User document does not exist during transaction!");
                }
                 const data = doc.data();

                // Double check limits within transaction
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
                    // Should be caught by pre-checks and button state, but handle defensively
                    throw new Error("Daily ad limit already reached.");
                }
            })
            .then(() => {
                // Transaction successful
                updatePointsUI(currentUserData.points); // Update header points
                updateAdsUI(); // Update ad section UI (count, cooldown, button state)
                 showMessage('ad-message', `✅ You earned ${pointsEarned} points!`, true, true); // Use success style

                 // Optional: Trigger Telegram haptic feedback on reward
                  if(Telegram.WebApp.HapticFeedback) {
                     Telegram.WebApp.HapticFeedback.notificationOccurred('success');
                  }

            })
            .catch(error => {
                console.error("Error updating user data after watching ad transaction:", error);
                 showMessage('ad-message', `Error rewarding points: ${error.message}`, true);
                 // Re-fetch data to sync UI if update failed
                 fetchUserData().then(updateAdsUI).catch(console.error);
            })
            .finally(() => {
                 // watchAdButton.disabled is handled by updateAdsUI
                 updateAdsUI(); // Ensure UI is correct state (shows cooldown or limit)
            });

        }).catch(error => {
            // Ad failed to load or user closed it without completing/rewarding
            console.error('Monetag ad failed or incomplete:', error);
             showMessage('ad-message', 'Could not show ad or ad was not completed. Please try again.', true);
            // No reward given, re-enable button and update UI
            watchAdButton.disabled = false;
             updateAdsUI(); // Ensure UI state is correct (shows cooldown if it started, or re-enables button)
        });
    } else {
         console.error("Monetag SDK function show_9342950 not found. Make sure the SDK script is loaded.");
         showMessage('ad-message', 'Ad service not available.', true);
         watchAdButton.disabled = false;
         updateAdsUI(); // Ensure UI state is correct
    }
}


// --- Referral Section Logic ---
const yourReferralCodeSpan = document.getElementById('your-referral-code');
const enterReferralArea = document.getElementById('enter-referral-area');
const referralInput = document.getElementById('referral-input');
const submitReferralButton = document.getElementById('submit-referral-button');
const referralMessage = document.getElementById('referral-message');
const copyReferralButton = document.querySelector('.copy-button[data-target="profile-referral-code"]');


function updateReferralUI() {
     if (!currentUserData) {
         yourReferralCodeSpan.textContent = 'Loading...';
         enterReferralArea.style.display = 'none';
         showMessage('referral-status-message', 'Loading referral data...', false);
         submitReferralButton.disabled = true;
         referralInput.disabled = true;
         if(copyReferralButton) copyReferralButton.disabled = true;
         return;
     }

     yourReferralCodeSpan.textContent = currentUserData.referral_code || 'Generating...';
     if(copyReferralButton) copyReferralButton.disabled = false; // Enable copy button once code is loaded


    if (currentUserData.referral_code_used) {
        enterReferralArea.style.display = 'none';
        showMessage('referral-status-message', 'You have already used a referral code.', false); // Info message
    } else {
        enterReferralArea.style.display = 'block';
         clearMessage('referral-status-message');
         submitReferralButton.disabled = false;
         referralInput.disabled = false;
         referralInput.value = ''; // Clear input when enabled
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
    if (!currentUserData || !db || currentUserData.referral_code_used || submitReferralButton.disabled) {
         if (!currentUserData) showMessage('referral-message', 'User data not loaded.', true);
         else if (currentUserData.referral_code_used) showMessage('referral-message', 'You have already used a referral code.', false);
         return;
    }

    if (!referralCode || referralCode === '') {
        showMessage('referral-message', 'Referral code cannot be empty.', true);
        return;
    }

     // Referral codes are prefixed with 'A'. Ensure input starts with 'A'.
     if (!referralCode.startsWith('A')) {
         showMessage('referral-message', 'Invalid referral code format.', true);
         return;
     }

    if (referralCode === currentUserData.referral_code) {
        showMessage('referral-message', 'You cannot use your own referral code.', true);
        return;
    }

    submitReferralButton.disabled = true;
    showMessage('referral-message', 'Checking code and applying...', false);

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
        const referrerRef = db.collection('users').doc(String(referrerData.telegram_user_id)); // Ensure referrer ID is string for doc ref

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const referrerDocInTx = await transaction.get(referrerRef); // Get referrer doc within transaction

            if (!userDoc.exists) {
                throw new Error("User document does not exist during transaction!");
            }
            if (!referrerDocInTx.exists) {
                 // Referrer document disappeared? Highly unlikely but defensive
                 throw new Error("Referrer document does not exist during transaction!");
            }

            const userData = userDoc.data();
            const referrerDataInTx = referrerDocInTx.data();

            // Final check in transaction: Has the user already used a code?
            if (userData.referral_code_used) {
                throw new Error("You have already used a referral code.");
            }

            // Update referred user (current user)
            const newPointsUser = (userData.points || 0) + REFERRED_BONUS; // Handle potential null points
            transaction.update(userRef, {
                points: newPointsUser,
                referred_by_user_id: referrerData.telegram_user_id, // Store referrer's numerical ID
                referral_code_used: true,
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Update referrer user
            const newPointsReferrer = (referrerDataInTx.points || 0) + REFERRER_BONUS; // Handle potential null points
            const newReferralsCount = (referrerDataInTx.referrals_count || 0) + 1; // Handle potential null count
            transaction.update(referrerRef, {
                points: newPointsReferrer,
                referrals_count: newReferralsCount,
                updated_at: firebase.firestore.FieldValue.serverTimestamp() // Update referrer's timestamp too
            });

             // Update local user data AFTER successful transaction
             currentUserData.points = newPointsUser;
             currentUserData.referred_by_user_id = referrerData.telegram_user_id;
             currentUserData.referral_code_used = true;
             // We don't update the referrer's count or points in *this* user's local data.
             // The referrer will see their updated count on their next app load or profile refresh.

        });

        // Transaction successful
        updatePointsUI(currentUserData.points); // Update current user's points in header
        updateReferralUI(); // Hide the input area and update status message
        showMessage('referral-message', `✅ Referral code applied! You got ${REFERRED_BONUS} points. Your referrer got ${REFERRER_BONUS} points.`, true, true); // Success style

         // Optional: Trigger Telegram haptic feedback on success
         if(Telegram.WebApp.HapticFeedback) {
            Telegram.WebApp.HapticFeedback.notificationOccurred('success');
         }


    } catch (error) {
        console.error("Error applying referral code:", error);
        if (typeof error === 'string' || error instanceof Error) {
             showMessage('referral-message', `Error applying referral code: ${error.message || error}`, true);
        } else {
            showMessage('referral-message', 'An unknown error occurred while applying referral code.', true);
        }
    } finally {
        submitReferralButton.disabled = false; // Re-enable button on error
         updateReferralUI(); // Ensure UI is correct state
    }
}

// Copy referral code button
// This listener should be added once when the script loads
document.querySelectorAll('.copy-button').forEach(button => {
    button.addEventListener('click', (event) => {
        const targetId = event.target.dataset.target;
        const textElement = document.getElementById(targetId);
        if (!textElement || !textElement.textContent || textElement.textContent === 'Loading...') {
             Telegram.WebApp.showAlert('Referral code not available yet.');
             return;
        }
        const textToCopy = textElement.textContent;


        navigator.clipboard.writeText(textToCopy).then(() => {
            // Optional: Show a temporary success message near the button
            const originalText = event.target.textContent;
            event.target.textContent = 'Copied!';
             // Optional: Trigger Telegram haptic feedback
             if(Telegram.WebApp.HapticFeedback) {
                Telegram.WebApp.HapticFeedback.notificationOccurred('success');
             }
            setTimeout(() => {
                event.target.textContent = originalText;
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy: ', err);
            // Optional: Show error message
             Telegram.WebApp.showAlert('Failed to copy referral code.'); // Use Telegram alert as fallback
             // Optional: Trigger Telegram haptic feedback
             if(Telegram.WebApp.HapticFeedback) {
                Telegram.WebApp.HapticFeedback.notificationOccurred('error');
             }
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
const withdrawalOptionsList = document.querySelector('.withdrawal-options ul');


function updateWithdrawUI() {
    if (!currentUserData) {
         withdrawPointsSpan.textContent = 'Loading...';
         withdrawAmountInput.disabled = true;
         withdrawMethodSelect.disabled = true;
         withdrawAddressInput.disabled = true;
         submitWithdrawalButton.disabled = true;
         showMessage('withdraw-message', 'Loading withdrawal data...', false);
         // Reset form fields
         withdrawAmountInput.value = '';
         withdrawMethodSelect.value = '';
         withdrawAddressInput.value = '';
         return;
     }

    withdrawPointsSpan.textContent = formatPoints(currentUserData.points);
    withdrawAmountInput.disabled = false;
    withdrawMethodSelect.disabled = false;
    withdrawAddressInput.disabled = false;


     // Update withdrawal options display (e.g., mark first withdrawal option)
     const withdrawalOptions = withdrawalOptionsList.querySelectorAll('li');
     withdrawalOptions.forEach(li => {
         // Restore original text and style before updating
         const originalText = li.dataset.originalText || li.textContent;
         li.textContent = originalText; // Reset text
         li.dataset.originalText = originalText; // Store original text if not already stored

         li.classList.remove('claimed'); // Remove any previous state
         li.style.textDecoration = 'none';
         li.style.opacity = '1';

         if (li.dataset.once === 'true' && currentUserData.claimed_first_withdrawal) {
             li.classList.add('claimed');
             li.textContent = `${originalText} (CLAIMED)`; // Add CLAIMED text
             li.style.textDecoration = 'line-through';
             li.style.opacity = '0.7';
         }
     });

    // Add input validation listener
    addWithdrawalValidationListeners(); // Ensure listeners are added
    checkWithdrawalFormValidity(); // Check initially
}

// Basic validation checker for the form
function checkWithdrawalFormValidity() {
    if (!currentUserData) {
         submitWithdrawalButton.disabled = true;
         showMessage('withdraw-message', 'Loading user data...', false);
         return false; // Form is not valid if no user data
    }

    const points = parseInt(withdrawAmountInput.value, 10);
    const method = withdrawMethodSelect.value;
    const address = withdrawAddressInput.value.trim();
    const currentPoints = currentUserData.points || 0; // Handle potential null points

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
              message = `Please enter one of the exact points amounts listed. Minimum is ${FIRST_WITHDRAWAL_MIN}.`;
         } else if (isFirstTimeOption && currentUserData.claimed_first_withdrawal) {
             isValid = false;
              message = 'The $0.10 option has already been claimed.';
         }
          // Double check against overall minimum just in case
         if (isValid && points < FIRST_WITHDRAWAL_MIN) {
              isValid = false;
              message = `Minimum withdrawal is ${FIRST_WITHDRAWAL_MIN} points.`;
         }
    }


    submitWithdrawalButton.disabled = !isValid;
    if (!isValid && message) {
        showMessage('withdraw-message', message, true);
    } else {
        clearMessage('withdraw-message'); // Clear message if form is valid
    }
    return isValid; // Return validation status
}

// Listen for input changes to validate (add once)
let withdrawalValidationListenersAdded = false;
function addWithdrawalValidationListeners() {
    if (!withdrawalValidationListenersAdded) {
        withdrawAmountInput.addEventListener('input', checkWithdrawalFormValidity);
        withdrawMethodSelect.addEventListener('change', checkWithdrawalFormValidity);
        withdrawAddressInput.addEventListener('input', checkWithdrawalFormValidity);
        withdrawalValidationListenersAdded = true;
    }
}
addWithdrawalValidationListeners(); // Add listeners when script loads


submitWithdrawalButton.addEventListener('click', handleSubmitWithdrawal);

async function handleSubmitWithdrawal() {
    if (!currentUserData || !db || submitWithdrawalButton.disabled) {
         if (!currentUserData) showMessage('withdraw-message', 'User data not loaded.', true);
         return;
    }

    // Re-validate just before submitting
     if (!checkWithdrawalFormValidity()) {
         console.warn("Attempted to submit invalid withdrawal after button click.");
         // checkWithdrawalFormValidity already showed the message
         return; // Exit if validation fails
     }

    const pointsToWithdraw = parseInt(withdrawAmountInput.value, 10);
    const method = withdrawMethodSelect.value;
    const address = withdrawAddressInput.value.trim();
    const userId = String(currentUserData.telegram_user_id);
    const userRef = db.collection('users').doc(userId);

     // Determine if this is the one-time withdrawal option BEFORE transaction
     let isFirstTimeOption = false;
     document.querySelectorAll('.withdrawal-options li').forEach(li => {
         if (parseInt(li.dataset.points, 10) === pointsToWithdraw && li.dataset.once === 'true') {
             isFirstTimeOption = true;
         }
     });


    submitWithdrawalButton.disabled = true; // Disable button during process
    showMessage('withdraw-message', 'Submitting withdrawal request...', false);

    try {
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new Error("User document does not exist during transaction!");
            }
            const data = userDoc.data();

            // Final validation within transaction based on data fetched in transaction
             // (Essential for preventing double-spending or claiming one-time option twice in rapid succession)
             if ((data.points || 0) < pointsToWithdraw) {
                 throw new Error("Insufficient points.");
             }
             if (isFirstTimeOption && data.claimed_first_withdrawal) {
                  throw new Error("The one-time withdrawal option has already been claimed.");
             }
             // Re-check if the requested amount matches a valid option (basic check)
             let isValidOptionAmount = false;
             document.querySelectorAll('.withdrawal-options li').forEach(li => {
                 if (parseInt(li.dataset.points, 10) === pointsToWithdraw) {
                      isValidOptionAmount = true;
                 }
             });
             if (!isValidOptionAmount) {
                  throw new Error("Invalid withdrawal amount specified.");
             }


            // Decrement points
            const newPoints = (data.points || 0) - pointsToWithdraw;
            transaction.update(userRef, {
                points: newPoints,
                claimed_first_withdrawal: data.claimed_first_withdrawal || isFirstTimeOption, // Mark if this was the first-time option being claimed
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Add withdrawal record
            const withdrawalsRef = db.collection('withdrawals');
            // Use .add() which is equivalent to .doc() then .set() with an auto ID in transactions
            transaction.set(withdrawalsRef.doc(), { // Use auto-generated ID
                telegram_user_id: currentUserData.telegram_user_id, // Store numerical ID
                telegram_username: currentUserData.telegram_username, // Store username for easier management
                points_withdrawn: pointsToWithdraw,
                method: method,
                address_or_id: address,
                status: 'pending', // Always pending on creation
                withdrawal_timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            });

             // Update local user data AFTER successful transaction
            currentUserData.points = newPoints;
             currentUserData.claimed_first_withdrawal = data.claimed_first_withdrawal || isFirstTimeOption;

        });

        // Transaction successful
        updatePointsUI(currentUserData.points); // Update header points
        updateWithdrawUI(); // Update withdrawal UI (points, claimed status, clears form implicitly via checkValidity)
        withdrawAmountInput.value = ''; // Explicitly clear form after success
        withdrawMethodSelect.value = '';
        withdrawAddressInput.value = '';
        showMessage('withdraw-message', '✅ Withdrawal request submitted successfully! Status: Pending', true, true); // Use success style

        // Optional: Trigger Telegram haptic feedback on success
         if(Telegram.WebApp.HapticFeedback) {
            Telegram.WebApp.HapticFeedback.notificationOccurred('success');
         }


    } catch (error) {
        console.error("Error submitting withdrawal:", error);
         if (typeof error === 'string' || error instanceof Error) {
             showMessage('withdraw-message', `Error submitting withdrawal: ${error.message || error}`, true);
         } else {
             showMessage('withdraw-message', 'An unknown error occurred while submitting withdrawal.', true);
         }
        submitWithdrawalButton.disabled = false; // Re-enable button on error
         updateWithdrawUI(); // Ensure UI is correct state
    }
}


// --- Initialize App on Telegram WebApp Ready ---

// Hide main app container initially
document.querySelector('.app-container').style.display = 'none';
// Show loading screen immediately
document.getElementById('loading-screen').style.display = 'flex';


Telegram.WebApp.ready();
// Telegram.WebApp.expand(); // Expand is called in initializeFirebaseAndUser after loading

// Event listener for when the Main WebApp is fully ready and initDataUnsafe is guaranteed to be populated
Telegram.WebApp.onEvent('mainWebAppReady', () => {
     console.log('Telegram Main WebApp Ready event fired.');
     // Ensure initDataUnsafe is available and has user data before proceeding
     if (Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
         console.log('initDataUnsafe and user available. Initializing Firebase and user.');
         // Now safe to show the app container and initialize
         document.querySelector('.app-container').style.display = 'flex';
         initializeFirebaseAndUser(); // Start the main initialization process
     } else {
          // This case should ideally not happen if mainWebAppReady fires correctly,
          // but it's a safeguard.
          console.error('Telegram initDataUnsafe or user not available after mainWebAppReady.');
          document.getElementById('loading-screen').innerHTML = '<p class="message error">Error: Could not get essential Telegram data after ready event. Please try again.</p>';
          Telegram.WebApp.showAlert('Error: Could not get required Telegram data. Please try reopening the app.');
     }
});

// DOMContentLoaded listener as a fallback or for testing outside Telegram
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded fired.');
     // If mainWebAppReady has already fired and initialized, do nothing here.
     // If opened directly in a browser (no initDataUnsafe), we still want the loading screen to show the error.
     // If opened in Telegram but mainWebAppReady doesn't fire immediately (unlikely but possible),
     // and DOMContentLoaded does, this might trigger init early IF initDataUnsafe is available.
    if (Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user && !currentUserData) { // Only initialize if not already initialized
         console.log('DOMContentLoaded: Telegram initDataUnsafe and user available. Triggering initialization.');
         document.querySelector('.app-container').style.display = 'flex'; // Show container if hidden
         initializeFirebaseAndUser();
    } else if (!Telegram.WebApp.initDataUnsafe || !Telegram.WebApp.initDataUnsafe.user) {
         console.warn('DOMContentLoaded: Telegram initDataUnsafe or user not available. Waiting for mainWebAppReady or displaying static error.');
         // The loading screen message "Error: Could not get Telegram user data. Please open from Telegram." should be visible.
         // This is expected if opened directly in a browser without mock data.
         document.querySelector('.app-container').style.display = 'flex'; // Show container to make error visible
         document.getElementById('loading-screen').style.display = 'flex'; // Ensure loading screen is visible
         document.getElementById('loading-screen').innerHTML = '<p class="message error">Error: Could not get Telegram user data. Please open the app from a Telegram bot or channel link.</p>';
    }
});


// --- Animation Handling (Button Glow Pulse) ---
// Add event listeners to trigger glow pulse on button click
document.querySelectorAll('.action-button, .task-button, .copy-button').forEach(button => {
    button.addEventListener('click', function() {
        // Only add pulse if not disabled
        if (this.disabled) return;

        // Remove existing animation class first to allow re-triggering
        const btn = this;
        btn.classList.remove('button-glow-pulse-red', 'button-glow-pulse-blue');

        // Add appropriate glow pulse class based on button type or section
        // Use a short timeout to allow the remove class to register before adding it back
        setTimeout(() => {
             if (btn.id === 'spin-button') {
                 btn.classList.add('button-glow-pulse-red'); // Spin button red glow
             } else if (btn.classList.contains('task-button') || btn.id === 'claim-tasks-button') {
                 btn.classList.add('button-glow-pulse-blue'); // Task buttons blue glow
             }
             else if (btn.id === 'watch-ad-button') {
                 btn.classList.add('button-glow-pulse-blue'); // Watch Ad button blue glow
             }
              else if (btn.id === 'submit-referral-button' || btn.classList.contains('copy-button')) {
                 btn.classList.add('button-glow-pulse-blue'); // Referral blue glow
              }
              else if (btn.id === 'submit-withdrawal-button') {
                   btn.classList.add('button-glow-pulse-red'); // Withdraw red glow
              }
        }, 10); // Small delay
    });
});
