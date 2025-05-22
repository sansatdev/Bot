// server.js
import dotenv from 'dotenv';
dotenv.config({ path: './w3s-dynamic-storage/.env' });

import express from 'express';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import fs from 'fs';

// Import the DBManager and ReferralManager
import DBManager from './dbManager.js';
import ReferralManager from './referralManager.js'; // NEW IMPORT

// __dirname equivalent for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants for Express server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// --- Bot Token (read from W3Schools environment variables) ---
const token = process.env.TELEGRAM_BOT_TOKEN;

process.on('uncaughtException', async (error) => {
    console.error('FATAL UNCAUGHT EXCEPTION! Shutting down gracefully...', error);
    await sendTelegramLog(`🚨 *UNCAUGHT EXCEPTION:*\n\`\`\`\n${error.stack || error.message}\n\`\`\`\nBot will attempt to restart.`);
    // Attempt to close DB connection if open
    if (dbManager && dbManager.db) {
        dbManager.db.close((err) => {
            if (err) console.error('Error closing DB on uncaught exception:', err.message);
        });
    }
    process.exit(1); // Exit with a non-zero code to indicate an error, allowing platform to restart
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('FATAL UNHANDLED REJECTION! Shutting down gracefully...', reason);
    await sendTelegramLog(`🚨 *UNHANDLED PROMISE REJECTION:*\nReason: \`${reason}\`\nPromise: \`${JSON.stringify(promise)}\`\nBot will attempt to restart.`);
    if (dbManager && dbManager.db) {
        dbManager.db.close((err) => {
            if (err) console.error('Error closing DB on unhandled rejection:', err.message);
        });
    }
    process.exit(1); // Exit, allowing platform to restart
});

if (!token) {
    console.error('FATAL ERROR: TELEGRAM_BOT_TOKEN environment variable is not set!');
}

const bot = token ? new TelegramBot(token, { polling: true }) : null;

// --- Telegram Logger Configuration (read from W3Schools environment variables) ---
const LOGGER_BOT_TOKEN = process.env.TELEGRAM_LOGGER_BOT_TOKEN;
const LOG_CHAT_ID = process.env.TELEGRAM_LOG_CHAT_ID;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID; // New: For direct queries

let loggerBot = null;
if (LOGGER_BOT_TOKEN && LOG_CHAT_ID) {
    try {
        loggerBot = new TelegramBot(LOGGER_BOT_TOKEN);
        console.log('✅ Telegram logger bot initialized.');
    } catch (e) {
        console.error('❌ Failed to initialize Telegram logger bot:', e.message);
        loggerBot = null;
    }
} else {
    console.warn('⚠️ Telegram logger bot token or chat ID not configured. Telegram logging disabled.');
}

async function sendTelegramLog(message) {
    if (loggerBot && LOG_CHAT_ID) {
        try {
            await loggerBot.sendMessage(LOG_CHAT_ID, `[BOT LOG] ${message}`, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('❌ Failed to send log to Telegram:', error.message);
        }
    }
}

// --- Session Management ---
const sessions = new Map();
const dbManager = new DBManager(); // Initialize DBManager
const referralManager = new ReferralManager(dbManager); // Initialize ReferralManager, passing dbManager

function getSession(chatId) {
    if (!sessions.has(chatId)) {
        sessions.set(chatId, {
            state: 'START', // Initial state
            coursePage: 0,
            selectedCourseId: null,
            selectedCourseName: null,
            phoneNumber: null,
        });
        console.log(`🆕 New session for chat ID: ${chatId}`);
    }
    return sessions.get(chatId);
}

function clearSession(chatId) {
    sessions.delete(chatId);
    console.log(`Session cleared for chat ID: ${chatId}.`);
}

// --- Main Menu Keyboard ---
const mainMenuKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '✅ Check Attendance', callback_data: 'check_attendance' }],
            [{ text: '📊 My Status', callback_data: 'my_status' }],
            [{ text: '💰 Plans', callback_data: 'plans' }],
            [{ text: '🤝 Invite & Earn', callback_data: 'invite_earn' }],
            [{ text: '🗣️ Talk with Us', callback_data: 'talk_with_us' }] // NEW BUTTON
        ]
    }
};

// --- Function to send the main menu ---
async function sendMainMenu(chatId, messageText = "Please choose an option from the menu below:") {
    await bot.sendMessage(chatId, messageText, {
        parse_mode: 'Markdown',
        ...mainMenuKeyboard
    });
    const session = getSession(chatId);
    session.state = 'MAIN_MENU'; // Set state to indicate awaiting main menu choice
}

// --- Course Data Pagination (Modified to use DBManager) ---
const COURSES_PER_PAGE = 30; // Number of courses per page

async function getCourseBatch(page) {
    const offset = page * COURSES_PER_PAGE;
    const courses = await dbManager.getCoursesPaged(offset, COURSES_PER_PAGE);
    const totalCoursesCount = await dbManager.getTotalCoursesCount();
    const totalCoursePages = Math.ceil(totalCoursesCount / COURSES_PER_PAGE);

    let message = `Please select your course by replying with the corresponding number:\n`;
    if (courses.length > 0) {
        courses.forEach(course => {
            message += `${course.originalIndex}. ${course.name}\n`;
        });
    } else {
        message += "No courses available. Please contact support.";
    }

    message += `\nPage ${page + 1} of ${totalCoursePages}`;
    if (page < totalCoursePages - 1) {
        message += `\n➡️ Reply 'f' for next page`;
    }
    if (page > 0) {
        message += `\n⬅️ Reply 'b' for previous page`;
    }
    message += `\nOr enter a course number to select.`;
    message += `\n\n_Type 'back' to return to the main menu._`; // Added instruction to go back

    return message;
}

// --- Helper function to get today's date inYYYY-MM-DD format ---
function getTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- Logging Function ---
function logAttendanceCheck(chatId, phoneNumber, courseName, apiResult) {
    const timestamp = new Date().toISOString();
    let logEntryForFile;
    let logEntryForTelegram;

    if (apiResult.success) {
        const student = apiResult.data;
        logEntryForFile = `[${timestamp}] ChatID: ${chatId}, Phone: "${phoneNumber}", Course: "${courseName}", Status: SUCCESS, Name: "${student.name}", Attended: ${student.lecturesAttended}/${student.totalLectures} (${student.percentage}%)`;
        logEntryForTelegram = `✅ *Attendance Check Success*\nChatID: \`${chatId}\`\nPhone: \`${phoneNumber}\`\nCourse: ${courseName}\nName: *${student.name}*\nAtt: ${student.lecturesAttended}/${student.totalLectures} (${student.percentage}%)`;
    } else {
        logEntryForFile = `[${timestamp}] ChatID: ${chatId}, Phone: "${phoneNumber}", Course: "${courseName}", Status: FAILED, Message: "${apiResult.message}"`;
        logEntryForTelegram = `❌ *Attendance Check Failed*\nChatID: \`${chatId}\`\nPhone: \`${phoneNumber}\`\nCourse: ${courseName}\nReason: ${apiResult.message}`;
    }

    const logFilePath = 'attendance_log.txt';
    fs.appendFile(logFilePath, logEntryForFile + '\n', (err) => {
        if (err) {
            console.error('⚠️ Failed to write to attendance log file:', err);
            sendTelegramLog(`⚠️ File Log Error: ${err.message}`);
        } else {
            console.log('📝 Attendance check logged successfully to file.');
        }
    });

    sendTelegramLog(logEntryForTelegram);
}

// --- Function to call your API ---
async function fetchStudentAttendance(classId, phoneNumber) {
    const apiUrl = 'https://api.teachusapp.com/teachus/attendance/student_attendance_list';
    const toDate = getTodayDate();
    const fromDate = '2024-11-21'; // Assuming this date is fixed for your API call
    const collegeCode = 'thakur_college_of_science_and_commerce';
    const subjectId = '0'; // Assuming this is fixed
    const jwtToken = process.env.TEACHUS_API_JWT_TOKEN;

    if (!jwtToken) {
        console.error('FATAL ERROR: TEACHUS_API_JWT_TOKEN environment variable is not set!');
        return { success: false, message: 'Internal server error: API authorization token missing.' };
    }

    const requestBody = new URLSearchParams({
        college_code: collegeCode,
        class_id: classId,
        subject_id: subjectId,
        from_date: fromDate,
        to_date: toDate,
    }).toString();

    const headers = {
        'Host': 'api.teachusapp.com',
        'Authorization': jwtToken,
        'Accept-Language': 'en-GB,en;q=0.9',
        'Sec-Ch-Ua': '"Not.A/Brand";v="99", "Chromium";v="136"',
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Sec-Ch-Ua-Mobile': '?0',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://academics.teachusapp.com',
        'Sec-Fetch-Site': 'same-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://academics.teachusapp.com/',
        'Accept-Encoding': 'gzip, deflate, br',
        'Priority': 'u=1, i'
    };

    try {
        console.log(`Sending API request for class_id: ${classId}, phone: ${phoneNumber}, subject_id: ${subjectId}`);

        const response = await axios.post(apiUrl, requestBody, { headers });
        console.log('API Raw Response Data:', JSON.stringify(response.data, null, 2));

        const parsedData = response.data;

        if (!parsedData || !Array.isArray(parsedData.student_list)) {
            const warnMessage = "API response does not contain a 'student_list' array as expected.";
            console.warn(warnMessage);
            console.warn('Full unexpected API response:', JSON.stringify(parsedData, null, 2));
            sendTelegramLog(`⚠️ API Response Warning: ${warnMessage} Full response: \`\`\`json\n${JSON.stringify(parsedData)}\n\`\`\``);
            return { success: false, message: "Attendance data is not available in the expected format for this course. (Missing 'student_list')" };
        }

        const studentDataList = parsedData.student_list;

        const student = studentDataList.find(s => s.contact === phoneNumber);

        if (student) {
            return {
                success: true,
                data: {
                    name: student.f_name,
                    lecturesAttended: student.lectures_attended,
                    totalLectures: student.total_lectures,
                    percentage: student.perecentage_att,
                }
            };
        } else {
            const notFoundMessage = `Student with phone number ${phoneNumber} not found in class ${classId}.`;
            console.log(notFoundMessage);
            return { success: false, message: `No data found for your phone number (${phoneNumber}) in the selected course.` };
        }

    } catch (error) {
        console.error('❌ Error fetching student attendance:', error.message);
        let errorMessage = 'Could not connect to the attendance service. Please check your internet connection or try again later.';
        if (error.response) {
            console.error('API Response Status:', error.response.status);
            console.error('API Response Data (Error):', JSON.stringify(error.response.data, null, 2));
            errorMessage = `Failed to retrieve data from the service (Status: ${error.response.status}). The server might be experiencing issues.`;
            sendTelegramLog(`❌ API Error (Status ${error.response.status}) for class_id \`${classId}\`, phone \`${phoneNumber}\`. Data: \`\`\`json\n${JSON.stringify(error.response.data)}\n\`\`\``);
        } else {
            sendTelegramLog(`❌ API Connection Error for class_id \`${classId}\`, phone \`${phoneNumber}\`. Error: \`${error.message}\``);
        }
        return { success: false, message: errorMessage };
    }
}

// --- Bot Logic ---
if (bot) {
    // Handle plain /start command and referral links
    bot.onText(/^\/start(?: (.+))?$/, async (msg, match) => {
        const chatId = msg.chat.id;
        const referrerId = match[1] ? match[1].replace('ref_', '') : null; // Extract referrer ID if present

        console.log(`📞 Message from Telegram chat ID ${chatId}: "/start" (Referrer: ${referrerId})`);

        // Record the user first, regardless of referral
        const isNewUser = await referralManager.recordUser(chatId); // Returns true if user was newly added

        if (referrerId && isNewUser) {
            // This is a new user who came via a referral link
            const referralResult = await referralManager.recordReferral(referrerId, chatId);
            if (referralResult.success) {
                await bot.sendMessage(chatId, `🎉 Welcome! ${referralResult.message}`);
                sendTelegramLog(`🔗 User \`${chatId}\` joined via referral from \`${referrerId}\`. Reward applied: ${referralResult.message}`);
            } else {
                await bot.sendMessage(chatId, `👋 Welcome! There was an issue with your referral: ${referralResult.message}`);
                sendTelegramLog(`⚠️ User \`${chatId}\` joined via referral from \`${referrerId}\`, but referral failed: ${referralResult.message}`);
            }
        } else if (referrerId && !isNewUser) {
            // User already known, came via referral link but no reward
            await bot.sendMessage(chatId, `👋 Welcome back! It looks like you've already started the bot before.`);
            sendTelegramLog(`ℹ️ User \`${chatId}\` (existing) started via referral from \`${referrerId}\`. No new referral recorded.`);
        } else {
            // Plain /start or existing user without referral
            await bot.sendMessage(chatId, "👋 Welcome! How can I help you today?");
            sendTelegramLog(`🔄 User \`${chatId}\` started/restarted bot (no referral).`);
        }

        clearSession(chatId); // Clear session on /start
        await sendMainMenu(chatId);
    });

    // Handle callback queries from inline buttons
    bot.on('callback_query', async (callbackQuery) => {
        const message = callbackQuery.message;
        const chatId = message.chat.id;
        const data = callbackQuery.data; // This is the callback_data from the button

        // Always answer callback queries to dismiss the loading state on the button
        await bot.answerCallbackQuery(callbackQuery.id);

        const session = getSession(chatId);

        let botResponseText = '';

        try {
            switch (data) {
                case 'check_attendance':
                    session.state = 'AWAITING_COURSE_SELECTION';
                    session.coursePage = 0; // Reset course page
                    botResponseText = await getCourseBatch(session.coursePage);
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                    sendTelegramLog(`✅ User \`${chatId}\` chose 'Check Attendance'.`);
                    break;

                case 'my_status':
                    botResponseText = await dbManager.getUsageStatus(chatId);
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                    sendTelegramLog(`📊 User \`${chatId}\` requested 'My Status'.`);
                    await sendMainMenu(chatId, "Here's your status. What's next?"); // Return to main menu
                    break;

                case 'plans':
                    session.state = 'SHOWING_PLANS';
                    botResponseText = dbManager.getPlansMessage();
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                    sendTelegramLog(`📈 User \`${chatId}\` chose 'Plans'.`);
                    await sendMainMenu(chatId, "Explore our plans! What's next?"); // Return to main menu after showing plans
                    break;

                case 'invite_earn':
                    // Generate referral link for the user
                    const botUsername = (await bot.getMe()).username;
                    const referralLink = `https://t.me/${botUsername}?start=ref_${chatId}`;
                    botResponseText = `🎉 *Invite & Earn Rewards!* 🎉\n\nShare this link with your friends:\n\`\`\`\n${referralLink}\n\`\`\`\n\nWhen a new user joins via your link, you'll earn special rewards!`;
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                    sendTelegramLog(`🤝 User \`${chatId}\` requested invite link.`);
                    await sendMainMenu(chatId, "Spread the word!"); // Return to main menu
                    break;

                case 'talk_with_us':
                    session.state = 'AWAITING_QUERY_TEXT';
                    botResponseText = "Please type your query or feedback now. I will forward it to the admin. Type '/cancel' to go back.";
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                    sendTelegramLog(`📝 User \`${chatId}\` chose 'Talk with Us'.`);
                    break;

                default:
                    botResponseText = "I didn't understand that. Please choose from the main menu.";
                    await sendMainMenu(chatId, botResponseText);
                    sendTelegramLog(`❓ User \`${chatId}\` sent unknown callback_data: \`${data}\`.`);
                    break;
            }
        } catch (error) {
            console.error("🚨 Error handling callback query:", error);
            sendTelegramLog(`🚨 *Callback Query Error:*\nChatID: \`${chatId}\`\nData: \`${data}\`\nError: \`${error.message}\`\nStack: \`${error.stack ? error.stack.substring(0, 500) + '...' : 'N/A'}\``);
            await bot.sendMessage(chatId, "Oops! Something went wrong. Please try again or type `/start`.");
            clearSession(chatId); // Clear session on error
            await sendMainMenu(chatId); // Return to main menu
        }
    });

    // --- Admin Commands ---
    // Make sure ADMIN_CHAT_ID is set in your .env for these to work securely
    const isAdmin = (chatId) => ADMIN_CHAT_ID && chatId.toString() === ADMIN_CHAT_ID.toString();

    bot.onText(/^\/leaderboard$/, async (msg) => {
        const chatId = msg.chat.id;
        if (!isAdmin(chatId)) {
            await bot.sendMessage(chatId, "🚫 You are not authorized to use this command.");
            return;
        }
        sendTelegramLog(`🔑 Admin \`${chatId}\` requested leaderboard.`);
        const leaderboard = await referralManager.getLeaderboard();
        let response = "🏆 *Top Referrers Leaderboard*\n\n";
        if (leaderboard.length === 0) {
            response += "No referrals recorded yet.";
        } else {
            leaderboard.forEach((entry, index) => {
                response += `${index + 1}. \`User ${entry.referrerId}\`: ${entry.rewarded_referrals} rewarded referrals (${entry.total_referrals} total)\n`;
            });
            response += "\n_Referrer IDs are displayed for admin purposes._";
        }
        await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    });

    bot.onText(/^\/reset_referral (.+)$/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAdmin(chatId)) {
            await bot.sendMessage(chatId, "🚫 You are not authorized to use this command.");
            return;
        }
        const referredUserIdToReset = match[1];
        sendTelegramLog(`🔑 Admin \`${chatId}\` attempting to reset referral for user \`${referredUserIdToReset}\`.`);
        const success = await referralManager.resetReferral(referredUserIdToReset);
        if (success) {
            await bot.sendMessage(chatId, `✅ Referral for user \`${referredUserIdToReset}\` has been reset (deleted).`);
            sendTelegramLog(`✅ Admin \`${chatId}\` *RESET* referral for user \`${referredUserIdToReset}\`.`);
        } else {
            await bot.sendMessage(chatId, `❌ No referral found or failed to reset for user \`${referredUserIdToReset}\`.`);
        }
    });

    bot.onText(/^\/revoke_referral (.+)$/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAdmin(chatId)) {
            await bot.sendMessage(chatId, "🚫 You are not authorized to use this command.");
            return;
        }
        const referredUserIdToRevoke = match[1];
        sendTelegramLog(`🔑 Admin \`${chatId}\` attempting to revoke reward for user \`${referredUserIdToRevoke}\`.`);
        const result = await referralManager.revokeReferralReward(referredUserIdToRevoke);
        if (result.success) {
            await bot.sendMessage(chatId, `✅ ${result.message}`);
            sendTelegramLog(`✅ Admin \`${chatId}\` *REVOKED* reward for user \`${referredUserIdToRevoke}\`.`);
        } else {
            await bot.sendMessage(chatId, `❌ ${result.message}`);
        }
    });

    bot.onText(/^\/config_reward (\d+) (.+)$/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (!isAdmin(chatId)) {
            await bot.sendMessage(chatId, "🚫 You are not authorized to use this command.");
            return;
        }
        const amount = parseInt(match[1], 10);
        const type = match[2]; // e.g., 'free_checks', 'plan_discount' (expand as needed)

        if (isNaN(amount) || amount <= 0) {
            await bot.sendMessage(chatId, "❌ Invalid amount. Please specify a positive number.");
            return;
        }

        // You might want to add validation for 'type' here
        if (!['free_checks', 'plan_discount'].includes(type)) { // Example types
             await bot.sendMessage(chatId, "❌ Invalid reward type. Supported types: `free_checks`.");
             return;
        }

        await referralManager.setSetting('referral_reward_amount', amount.toString());
        await referralManager.setSetting('referral_reward_type', type);

        await bot.sendMessage(chatId, `✅ Referral reward configured: ${amount} of type '${type}'.`);
        sendTelegramLog(`🔑 Admin \`${chatId}\` configured referral reward to: ${amount} ${type}.`);
    });

    // --- General Message Handler (for text inputs) ---
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userMessage = msg.text ? msg.text.trim().toLowerCase() : '';

        // Ignore commands already handled by specific onText handlers,
        // and ignore messages from other bots or channels, and callback query related messages.
        if (msg.from.is_bot || msg.chat.type !== 'private' || userMessage.startsWith('/start') || msg.data || userMessage.startsWith('/leaderboard') || userMessage.startsWith('/reset_referral') || userMessage.startsWith('/revoke_referral') || userMessage.startsWith('/config_reward')) {
            return;
        }

        console.log(`📞 Text message from Telegram chat ID ${chatId}: "${userMessage}"`);

        const session = getSession(chatId);

        let botResponseText = '';

        try {
            // Handle 'back' command to return to main menu from course selection
            if (userMessage === 'back' && (session.state === 'AWAITING_COURSE_SELECTION' || session.state === 'AWAITING_PHONE' || session.state === 'AWAITING_QUERY_TEXT')) {
                clearSession(chatId); // Clear session to ensure clean slate for main menu
                await sendMainMenu(chatId, "Returning to the main menu.");
                sendTelegramLog(`↩️ User \`${chatId}\` typed 'back' to main menu.`);
                return; // Exit after sending menu
            }

            // Commands that are also buttons, handled by `onText` if typed, or `callback_query` if button pressed
            if (userMessage === '/plans') {
                session.state = 'SHOWING_PLANS';
                botResponseText = dbManager.getPlansMessage();
                sendTelegramLog(`📈 User \`${chatId}\` requested plans.`);
                await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                await sendMainMenu(chatId, "Explore our plans! What's next?"); // Return to main menu after showing plans
            } else if (userMessage === '/status') {
                botResponseText = await dbManager.getUsageStatus(chatId);
                sendTelegramLog(`📊 User \`${chatId}\` requested status.`);
                await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                await sendMainMenu(chatId, "Here's your status. What's next?"); // Return to main menu
            }
            // Buy command still expects a text input
            else if (userMessage.startsWith('/buy ')) {
                const parts = userMessage.split(' ');
                const planKey = parts[1];
                const planDetails = dbManager.getPlanDetails(planKey);

                if (planDetails) {
                    session.state = 'AWAITING_PAYMENT_CONFIRMATION';
                    session.pendingPlanKey = planKey;
                    botResponseText = `To confirm enrollment in *${planDetails.name}* for ${planDetails.price} Rs, reply 'yes'. (This is a mock payment for now.)`;
                    console.log(`💬 Bot Response: User ${chatId} initiated enrollment in ${planKey}.`);
                    sendTelegramLog(`💳 User \`${chatId}\` attempting to buy plan: *${planDetails.name}*.`);
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                } else {
                    botResponseText = "❌ Invalid program. Please use `/plans` to see available options.";
                    console.log(`💬 Bot Response: User ${chatId} entered invalid plan key.`);
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                    await sendMainMenu(chatId); // Return to main menu on invalid input
                }
            } else if (session.state === 'AWAITING_PAYMENT_CONFIRMATION' && userMessage === 'yes') {
                const planKey = session.pendingPlanKey;
                if (await dbManager.activatePlan(chatId, planKey)) {
                    botResponseText = `🎉 Congratulations! You have successfully enrolled in the *${dbManager.getPlanDetails(planKey).name}*. We're excited to help you boost your attendance! Type \`/status\` to verify.`;
                    sendTelegramLog(`💰 User \`${chatId}\` *ENROLLED* in plan: *${dbManager.getPlanDetails(planKey).name}*.`);
                } else {
                    botResponseText = `❌ Payment failed or program activation error. Please try again or contact support.`;
                    sendTelegramLog(`⛔ User \`${chatId}\` payment *FAILED* for plan: *${dbManager.getPlanDetails(planKey).name}*.`);
                }
                session.state = 'MAIN_MENU'; // Reset state after completion
                session.pendingPlanKey = null;
                await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                await sendMainMenu(chatId); // Return to main menu
            }
            else if (userMessage === '/hiddenfeature') {
                if (await dbManager.isHiddenFeatureUnlocked(chatId, 'exclusive_strategies_tips')) {
                    botResponseText = "📈 Here are exclusive strategies and tips to boost your attendance: [Link to resource / Mock Data for Tips]";
                    sendTelegramLog(`🎁 User \`${chatId}\` accessed *Exclusive Strategies & Tips*.`);
                } else if (await dbManager.isHiddenFeatureUnlocked(chatId, 'priority_consultation')) {
                     botResponseText = "📞 You have priority consultation! Please contact us to schedule your 1-on-1 session via email at support@example.com (Mock Support Info).";
                     sendTelegramLog(`🎁 User \`${chatId}\` accessed *Priority Consultation*.`);
                } else if (await dbManager.isHiddenFeatureUnlocked(chatId, 'personalized_coaching_analytics')) {
                     botResponseText = "📊 Access your Personalized Analytics Dashboard and coaching schedule here: [Mock URL for Analytics / Coaching]";
                     sendTelegramLog(`🎁 User \`${chatId}\` accessed *Personalized Coaching & Analytics*.`);
                }
                else {
                    botResponseText = "🔐 This is a premium attendance boosting feature. Please enroll in a program to unlock it!";
                    sendTelegramLog(`🚫 User \`${chatId}\` attempted to access hidden feature without plan.`);
                }
                await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                await sendMainMenu(chatId); // Return to main menu
            }
            // --- Query/Feedback Feature ---
            else if (session.state === 'AWAITING_QUERY_TEXT') {
                if (userMessage === '/cancel') {
                    session.state = 'MAIN_MENU'; // Go back to main menu state
                    botResponseText = "Query submission cancelled. Returning to the main menu.";
                    sendTelegramLog(`✖️ User \`${chatId}\` cancelled query submission.`);
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                    await sendMainMenu(chatId);
                } else {
                    // Forward the query to the admin chat if set, otherwise to log chat
                    const queryMessage = `📢 *User Query from ${chatId}:*\n\n\`\`\`\n${msg.text}\n\`\`\``;
                    if (ADMIN_CHAT_ID) {
                        await loggerBot.sendMessage(ADMIN_CHAT_ID, queryMessage, { parse_mode: 'Markdown' });
                    } else {
                        await sendTelegramLog(queryMessage); // Fallback to LOG_CHAT_ID
                    }
                    botResponseText = "Thank you! Your query has been successfully submitted. We will get back to you if needed. Returning to the main menu.";
                    session.state = 'MAIN_MENU'; // Reset state after submission
                    sendTelegramLog(`✅ User \`${chatId}\` submitted query.`);
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                    await sendMainMenu(chatId);
                }
            }
            // Handle pagination and course selection only when in the correct state
            else if (session.state === 'AWAITING_COURSE_SELECTION') {
                const totalCoursesCount = await dbManager.getTotalCoursesCount();
                const totalCoursePages = Math.ceil(totalCoursesCount / COURSES_PER_PAGE);

                if (userMessage === 'f') {
                    if (session.coursePage < totalCoursePages - 1) {
                        session.coursePage++;
                        botResponseText = await getCourseBatch(session.coursePage);
                        console.log(`💬 Bot Response: User navigated forward to page ${session.coursePage + 1}.`);
                    } else {
                        botResponseText = "🚫 You're already at the **last page**. Use 'b' to go back or select a course number.";
                    }
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                } else if (userMessage === 'b') {
                    if (session.coursePage > 0) {
                        session.coursePage--;
                        botResponseText = await getCourseBatch(session.coursePage);
                    } else {
                        botResponseText = "🚫 You're already at the **first page**. Use 'f' to go forward or select a course number.";
                    }
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                } else if (/^\d+$/.test(userMessage)) {
                    const selectedNumber = parseInt(userMessage, 10);
                    const selectedCourse = await dbManager.getCourseById(selectedNumber);

                    if (selectedCourse) {
                        session.selectedCourseId = selectedCourse.id;
                        session.selectedCourseName = selectedCourse.name;
                        session.state = 'AWAITING_PHONE';
                        botResponseText = `You selected: *${selectedCourse.name}*. Please enter your **10-digit phone number** to check your attendance:`;
                        sendTelegramLog(`✅ User \`${chatId}\` selected course: *${selectedCourse.name}* (\`${selectedCourse.id}\`).`);
                        await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                    } else {
                        botResponseText = "❌ Invalid course number. Please use 'f', 'b', or enter a valid number from the list.\n\n_Type 'back' to return to the main menu._";
                        sendTelegramLog(`❌ User \`${chatId}\` entered invalid course number: \`${userMessage}\`.`);
                        await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                    }
                } else {
                    botResponseText = "❌ Invalid input. To navigate, reply 'f' for next, 'b' for back, or enter a number to choose a course.\n\n_Type 'back' to return to the main menu._";
                    sendTelegramLog(`❌ User \`${chatId}\` invalid input in course selection state: \`${userMessage}\`.`);
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                }
            }
            else if (session.state === 'AWAITING_PHONE') {
                const submittedPhoneNumber = userMessage;

                if (/^\d{10}$/.test(submittedPhoneNumber)) {
                    const courseId = session.selectedCourseId;
                    const courseName = session.selectedCourseName;

                    if (!courseId) {
                        botResponseText = "It seems I lost track of your course selection. Please type 'back' to return to the main menu.";
                        clearSession(chatId);
                        sendTelegramLog(`⚠️ Missing course ID for \`${chatId}\` in AWAITING_PHONE state. Session cleared.`);
                        await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                        await sendMainMenu(chatId);
                    } else {
                        const usageStatus = await dbManager.canPerformCheck(chatId);
                        if (!usageStatus.allowed) {
                            botResponseText = `🚫 ${await dbManager.getUsageStatus(chatId)}\n\nTo continue, please purchase a plan using \`/plans\` or choose another option from the main menu.`;
                            sendTelegramLog(`🚫 User \`${chatId}\` hit free limit for attendance check or plan expired.`);
                            session.state = 'MAIN_MENU'; // Return to main menu state
                            await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                            await sendMainMenu(chatId);
                        } else {
                            await bot.sendMessage(chatId, "⏳ Fetching your attendance data...");
                            sendTelegramLog(`📞 User \`${chatId}\` checking attendance for course *${courseName}* (\`${courseId}\`) with phone: \`${submittedPhoneNumber}\`.`);

                            const apiResult = await fetchStudentAttendance(courseId, submittedPhoneNumber);

                            logAttendanceCheck(chatId, submittedPhoneNumber, courseName, apiResult);

                            if (apiResult.success) {
                                if (usageStatus.reason === 'free_limit') {
                                    await dbManager.recordFreeCheck(chatId);
                                }
                                const student = apiResult.data;
                                botResponseText = `✅ Attendance Report for *${student.name}* in *${courseName}*:\n` +
                                                  `Lectures Attended: ${student.lecturesAttended}\n` +
                                                  `Total Lectures: ${student.totalLectures}\n` +
                                                  `Percentage: ${student.percentage}%`;

                                botResponseText += `\n\n${await dbManager.getUsageStatus(chatId)}\n\nWould you like to check attendance for another number in *this course*? Please enter a new **10-digit number**. Or type 'back' to return to the main menu.`;
                                session.state = 'AWAITING_PHONE'; // Stay in this state for more checks in same course
                                await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                            } else {
                                botResponseText = `An error occurred: ${apiResult.message}\n\nType your **10-digit number** again for *${courseName}*, or type 'back' to return to the main menu.`;
                                session.state = 'AWAITING_PHONE';
                                await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                            }
                        }
                    }
                } else {
                    botResponseText = "❌ Invalid phone number format. Please enter a valid **10-digit mobile number**, like `9876543210`.\n\n_Type 'back' to return to the main menu._";
                    sendTelegramLog(`❌ User \`${chatId}\` entered invalid phone format: \`${userMessage}\`.`);
                    session.state = 'AWAITING_PHONE'; // Stay in this state for correction
                    await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                }
            } else if (session.state === 'MAIN_MENU') {
                // If user sends text when main menu is expected, just send the menu again
                await sendMainMenu(chatId, "Please select an option using the buttons below.");
                sendTelegramLog(`❓ User \`${chatId}\` sent unexpected text in MAIN_MENU state: \`${userMessage}\`.`);
            }
            else {
                // Catch-all for unexpected states
                botResponseText = "I'm not sure what you mean. Let's get you back to the main menu.";
                clearSession(chatId);
                sendTelegramLog(`⚠️ User \`${chatId}\` in unexpected state: \`${session.state}\` with message \`${userMessage}\`. Session cleared, prompting main menu.`);
                await bot.sendMessage(chatId, botResponseText, { parse_mode: 'Markdown' });
                await sendMainMenu(chatId);
            }

        } catch (error) {
            console.error("🚨 Unhandled error in message handler:", error);
            console.error("🚨 Error Stack:", error.stack);
            sendTelegramLog(`🚨 *Unhandled Error in Bot Logic:*\nChatID: \`${chatId}\`\nMessage: \`${userMessage}\`\nError: \`${error.message}\`\nStack: \`${error.stack ? error.stack.substring(0, 1000) + '...' : 'N/A'}\``);
            await bot.sendMessage(chatId, "Oops! Something went wrong on our end. Please try again by typing `/start`.");
            clearSession(chatId);
            await sendMainMenu(chatId); // Attempt to return to main menu on error
        }
    });

    console.log('🚀 Telegram bot is running and ready to receive messages...');
} else {
    console.error('❌ Telegram bot not initialized due to missing token. Bot functionality disabled.');
}


// App
const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('Telegram bot is running. Visit your Telegram bot to interact.');
});

app.listen(PORT, HOST, () => {
  console.log(`Express server running on http://${HOST}:${PORT}`);
  sendTelegramLog('🚀 Main bot started successfully via Express server!');
});