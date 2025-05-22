// dbManager.js
import sqlite3 from 'sqlite3';
const DB_PATH = './w3s-dynamic-storage/database.db';

const PLANS = {
    '1_month_boost': {
        name: '1 Month Attendance Boost',
        price: 500,
        durationDays: 30,
        hiddenFeature: 'exclusive_strategies_tips',
        description: 'Get your attendance boosted to 90% within 1 month, plus exclusive strategies and tips.',
        attendanceFocus: true,
        targetPercentage: 90
    },
    '3_months_pro': {
        name: '3 Months Pro Attendance Program',
        price: 1200,
        durationDays: 90,
        hiddenFeature: 'priority_consultation',
        description: 'Comprehensive 3-month program to achieve consistent 90% attendance, plus priority 1-on-1 consultation.',
        attendanceFocus: true,
        targetPercentage: 90
    },
    '6_months_elite': {
        name: '6 Months Elite Attendance Coaching',
        price: 2000,
        durationDays: 180,
        hiddenFeature: 'personalized_coaching_analytics',
        description: '6-month intensive coaching for guaranteed 90% attendance & academic success, plus personalized analytics dashboard and direct coaching.',
        attendanceFocus: true,
        targetPercentage: 90
    }
};

const FREE_LIMIT = 5; // Max free attendance checks

class DBManager {
    constructor() {
        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('❌ Could not connect to SQLite database:', err.message);
            } else {
                console.log('✅ Connected to SQLite database.');
                this.db.serialize(() => {
                    // Table for user plans
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS user_plans (
                            chatId TEXT PRIMARY KEY,
                            attendanceChecksUsed INTEGER DEFAULT 0,
                            planActive INTEGER DEFAULT 0,
                            planExpiresAt TEXT,
                            planDetails TEXT,
                            hiddenFeatureUnlocked INTEGER DEFAULT 0
                        )
                    `, (createErr) => {
                        if (createErr) {
                            console.error('❌ Error creating user_plans table:', createErr.message);
                        } else {
                            console.log('✅ User plans table ensured.');
                        }
                    });

                    // New table for courses
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS courses (
                            originalIndex INTEGER PRIMARY KEY,
                            name TEXT NOT NULL,
                            apiId TEXT NOT NULL UNIQUE
                        )
                    `, (createErr) => {
                        if (createErr) {
                            console.error('❌ Error creating courses table:', createErr.message);
                        } else {
                            console.log('✅ Courses table ensured.');
                        }
                    });

                    // --- NEW: Table for referral codes and inviter info ---
                    // Added inviterBenefitGranted column
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS referral_codes (
                            chatId TEXT PRIMARY KEY,
                            referralCode TEXT UNIQUE NOT NULL,
                            referredBy TEXT, -- chatId of the inviter
                            inviterBenefitGranted INTEGER DEFAULT 0, -- NEW: 0 for not granted, 1 for granted
                            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
                        )
                    `, (createErr) => {
                        if (createErr) {
                            console.error('❌ Error creating referral_codes table:', createErr.message);
                        } else {
                            console.log('✅ Referral codes table ensured.');
                            // Add column if it doesn't exist (for existing databases)
                            this.db.run(`ALTER TABLE referral_codes ADD COLUMN inviterBenefitGranted INTEGER DEFAULT 0`, (alterErr) => {
                                if (alterErr && !alterErr.message.includes('duplicate column name')) {
                                    console.warn('⚠️ Could not add inviterBenefitGranted column (might already exist):', alterErr.message);
                                } else {
                                    console.log('✅ Ensured inviterBenefitGranted column in referral_codes table.');
                                }
                            });
                        }
                    });

                    // --- NEW: Table for storing benefits granted to users ---
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS user_benefits (
                            chatId TEXT PRIMARY KEY,
                            unlimitedChecksExpiresAt TEXT,
                            attendanceBoostSubjectId TEXT,
                            attendanceBoostSubjectName TEXT,
                            hasReceivedReferralBenefit INTEGER DEFAULT 0 -- New column
                        )
                    `, (createErr) => {
                        if (createErr) {
                            console.error('❌ Error creating user_benefits table:', createErr.message);
                        } else {
                            console.log('✅ User benefits table ensured.');
                            // Add column if it doesn't exist (for existing databases)
                            this.db.run(`ALTER TABLE user_benefits ADD COLUMN hasReceivedReferralBenefit INTEGER DEFAULT 0`, (alterErr) => {
                                if (alterErr && !alterErr.message.includes('duplicate column name')) {
                                    console.warn('⚠️ Could not add hasReceivedReferralBenefit column (might already exist):', alterErr.message);
                                } else {
                                    console.log('✅ Ensured hasReceivedReferralBenefit column in user_benefits table.');
                                }
                            });
                        }
                    });
                });
            }
        });
    }

    // --- Course Management Methods ---

    async insertCourse(originalIndex, name, apiId) {
        return new Promise((resolve, reject) => {
            this.db.run(`INSERT OR IGNORE INTO courses (originalIndex, name, apiId) VALUES (?, ?, ?)`,
                [originalIndex, name, apiId],
                function(err) {
                    if (err) {
                        console.error(`❌ Error inserting course ${name}:`, err.message);
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    async getAllCourses() {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT originalIndex, name, apiId FROM courses ORDER BY originalIndex ASC`, [], (err, rows) => {
                if (err) {
                    console.error('❌ Error fetching all courses:', err.message);
                    reject(err);
                } else {
                    resolve(rows.map(row => ({
                        originalIndex: row.originalIndex,
                        name: row.name,
                        id: row.apiId
                    })));
                }
            });
        });
    }

    async getCourseById(originalIndex) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT originalIndex, name, apiId FROM courses WHERE originalIndex = ?`, [originalIndex], (err, row) => {
                if (err) {
                    console.error(`❌ Error fetching course by index ${originalIndex}:`, err.message);
                    reject(err);
                } else if (row) {
                    resolve({
                        originalIndex: row.originalIndex,
                        name: row.name,
                        id: row.apiId
                    });
                } else {
                    resolve(null);
                }
            });
        });
    }

    async getCoursesPaged(offset, limit) {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT originalIndex, name, apiId FROM courses ORDER BY originalIndex ASC LIMIT ? OFFSET ?`,
                [limit, offset],
                (err, rows) => {
                    if (err) {
                        console.error(`❌ Error fetching courses page (offset ${offset}, limit ${limit}):`, err.message);
                        reject(err);
                    } else {
                        resolve(rows.map(row => ({
                            originalIndex: row.originalIndex,
                            name: row.name,
                            id: row.apiId
                        })));
                    }
                }
            );
        });
    }

    async getTotalCoursesCount() {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT COUNT(*) as count FROM courses`, [], (err, row) => {
                if (err) {
                    console.error('❌ Error fetching total course count:', err.message);
                    reject(err);
                } else {
                    resolve(row.count);
                }
            });
        });
    }

    // --- User Plan Management Methods ---

    async getUserPlan(chatId) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT * FROM user_plans WHERE chatId = ?`, [chatId], (err, row) => {
                if (err) {
                    console.error(`❌ Error fetching plan for ${chatId}:`, err.message);
                    reject(err);
                } else if (row) {
                    if (row.planDetails) {
                        row.planDetails = JSON.parse(row.planDetails);
                    }
                    row.planActive = Boolean(row.planActive);
                    row.hiddenFeatureUnlocked = Boolean(row.hiddenFeatureUnlocked);
                    resolve(row);
                } else {
                    resolve({
                        chatId: chatId,
                        attendanceChecksUsed: 0,
                        planActive: false,
                        planExpiresAt: null,
                        planDetails: null,
                        hiddenFeatureUnlocked: false,
                    });
                }
            });
        });
    }

    async saveUserPlan(planData) {
        return new Promise((resolve, reject) => {
            const { chatId, attendanceChecksUsed, planActive, planExpiresAt, planDetails, hiddenFeatureUnlocked } = planData;
            this.db.run(`
                INSERT OR REPLACE INTO user_plans (
                    chatId, attendanceChecksUsed, planActive, planExpiresAt, planDetails, hiddenFeatureUnlocked
                ) VALUES (?, ?, ?, ?, ?, ?)
            `, [
                chatId,
                attendanceChecksUsed,
                planActive ? 1 : 0,
                planExpiresAt,
                planDetails ? JSON.stringify(planDetails) : null,
                hiddenFeatureUnlocked ? 1 : 0
            ], (err) => {
                if (err) {
                    console.error(`❌ Error saving plan for ${chatId}:`, err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    // --- Referral Methods ---

    async generateReferralCode(chatId) {
        const code = `INVITE${chatId.toString().slice(-6)}`;
        return new Promise((resolve, reject) => {
            this.db.run(`INSERT OR IGNORE INTO referral_codes (chatId, referralCode) VALUES (?, ?)`,
                [chatId, code],
                (err) => {
                    if (err) {
                        console.error(`❌ Error generating referral code for ${chatId}:`, err.message);
                        reject(err);
                    } else if (this.changes > 0) {
                        console.log(`✅ Generated referral code ${code} for ${chatId}`);
                        resolve(code);
                    } else {
                        this.db.get(`SELECT referralCode FROM referral_codes WHERE chatId = ?`, [chatId], (err, row) => {
                            if (err) reject(err);
                            else resolve(row ? row.referralCode : null);
                        });
                    }
                }
            );
        });
    }

    async getReferralCode(chatId) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT referralCode FROM referral_codes WHERE chatId = ?`, [chatId], (err, row) => {
                if (err) {
                    console.error(`❌ Error fetching referral code for ${chatId}:`, err.message);
                    reject(err);
                } else {
                    resolve(row ? row.referralCode : null);
                }
            });
        });
    }

    async getChatIdByReferralCode(referralCode) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT chatId FROM referral_codes WHERE referralCode = ?`, [referralCode], (err, row) => {
                if (err) {
                    console.error(`❌ Error fetching chatId by referral code ${referralCode}:`, err.message);
                    reject(err);
                } else {
                    resolve(row ? row.chatId : null);
                }
            });
        });
    }

    // New: Check if inviter has already been credited for this specific referral
    async hasInviterBeenCredited(inviteeChatId) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT inviterBenefitGranted FROM referral_codes WHERE chatId = ?`, [inviteeChatId], (err, row) => {
                if (err) {
                    console.error(`❌ Error checking inviter benefit status for invitee ${inviteeChatId}:`, err.message);
                    reject(err);
                } else {
                    resolve(row ? Boolean(row.inviterBenefitGranted) : false);
                }
            });
        });
    }

    // New: Mark inviter as credited for this specific referral
    async markInviterCredited(inviteeChatId) {
        return new Promise((resolve, reject) => {
            this.db.run(`UPDATE referral_codes SET inviterBenefitGranted = 1 WHERE chatId = ?`,
                [inviteeChatId],
                function(err) {
                    if (err) {
                        console.error(`❌ Error marking inviter credited for invitee ${inviteeChatId}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`✅ Inviter marked as credited for invitee ${inviteeChatId}.`);
                        resolve(this.changes > 0);
                    }
                }
            );
        });
    }

    async recordReferral(inviteeChatId, inviterChatId) {
        return new Promise((resolve, reject) => {
            this.db.run(`UPDATE referral_codes SET referredBy = ?, inviterBenefitGranted = 0 WHERE chatId = ?`, // Ensure reset for new referrals
                [inviterChatId, inviteeChatId],
                function(err) {
                    if (err) {
                        console.error(`❌ Error recording referral for ${inviteeChatId} by ${inviterChatId}:`, err.message);
                        reject(err);
                    } else {
                        console.log(`✅ Recorded referral: ${inviteeChatId} referred by ${inviterChatId}. Changes: ${this.changes}`);
                        resolve(this.changes > 0);
                    }
                }
            );
        });
    }

    // --- Benefit Management Methods ---

    async getUserBenefits(chatId) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT * FROM user_benefits WHERE chatId = ?`, [chatId], (err, row) => {
                if (err) {
                    console.error(`❌ Error fetching benefits for ${chatId}:`, err.message);
                    reject(err);
                } else if (row) {
                    row.hasReceivedReferralBenefit = Boolean(row.hasReceivedReferralBenefit);
                    resolve(row);
                } else {
                    resolve({
                        chatId: chatId,
                        unlimitedChecksExpiresAt: null,
                        attendanceBoostSubjectId: null,
                        attendanceBoostSubjectName: null,
                        hasReceivedReferralBenefit: false
                    });
                }
            });
        });
    }

    async saveUserBenefits(benefitData) {
        return new Promise((resolve, reject) => {
            const { chatId, unlimitedChecksExpiresAt, attendanceBoostSubjectId, attendanceBoostSubjectName, hasReceivedReferralBenefit } = benefitData;
            this.db.run(`
                INSERT OR REPLACE INTO user_benefits (
                    chatId, unlimitedChecksExpiresAt, attendanceBoostSubjectId, attendanceBoostSubjectName, hasReceivedReferralBenefit
                ) VALUES (?, ?, ?, ?, ?)
            `, [
                chatId,
                unlimitedChecksExpiresAt,
                attendanceBoostSubjectId,
                attendanceBoostSubjectName,
                hasReceivedReferralBenefit ? 1 : 0
            ], (err) => {
                if (err) {
                    console.error(`❌ Error saving benefits for ${chatId}:`, err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async hasUnlimitedChecks(chatId) {
        const benefits = await this.getUserBenefits(chatId);
        if (benefits.unlimitedChecksExpiresAt && new Date() < new Date(benefits.unlimitedChecksExpiresAt)) {
            return true;
        }
        return false;
    }

    async hasReceivedReferralBenefits(chatId) {
        const benefits = await this.getUserBenefits(chatId);
        return benefits.hasReceivedReferralBenefit;
    }

    async markReferralBenefitsReceived(chatId) {
        let benefits = await this.getUserBenefits(chatId);
        benefits.hasReceivedReferralBenefit = true;
        await this.saveUserBenefits(benefits);
        console.log(`User ${chatId} marked as having received referral benefits.`);
    }

    async applyReferralBenefits(chatId, courseId = null, courseName = null) {
        let benefits = await this.getUserBenefits(chatId);

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 1);
        benefits.unlimitedChecksExpiresAt = expiryDate.toISOString();

        if (courseId && courseName) {
            benefits.attendanceBoostSubjectId = courseId;
            benefits.attendanceBoostSubjectName = courseName;
        }

        await this.saveUserBenefits(benefits);
        console.log(`Applied referral benefits to ${chatId}: unlimited checks until ${expiryDate}, attendance boost for ${courseName || 'no specific subject yet'}`);
    }

    // --- Modified Methods to include referral benefits ---

    async canPerformCheck(chatId) {
        const hasReferralUnlimited = await this.hasUnlimitedChecks(chatId);
        if (hasReferralUnlimited) {
            return { allowed: true, reason: 'referral_unlimited' };
        }

        const planData = await this.getUserPlan(chatId);

        if (planData.planActive && planData.planExpiresAt && new Date() < new Date(planData.planExpiresAt)) {
            return { allowed: true, reason: 'active_plan' };
        }

        if (planData.attendanceChecksUsed < FREE_LIMIT) {
            return { allowed: true, reason: 'free_limit' };
        }

        return { allowed: false, reason: 'limit_exceeded' };
    }

    async recordFreeCheck(chatId) {
        const planData = await this.getUserPlan(chatId);
        const hasUnlimited = await this.hasUnlimitedChecks(chatId);
        if (!planData.planActive && !hasUnlimited) {
            planData.attendanceChecksUsed++;
            await this.saveUserPlan(planData);
            console.log(`Recorded free check for ${chatId}. Used: ${planData.attendanceChecksUsed}`);
        }
    }

    async getUsageStatus(chatId) {
        const benefits = await this.getUserBenefits(chatId);
        let statusMessages = [];

        if (benefits.unlimitedChecksExpiresAt && new Date() < new Date(benefits.unlimitedChecksExpiresAt)) {
            const daysLeft = Math.ceil((new Date(benefits.unlimitedChecksExpiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            statusMessages.push(`🎁 You have *unlimited attendance checks* for ${daysLeft} day(s) from a referral!`);
        }
        if (benefits.attendanceBoostSubjectId) {
            statusMessages.push(`🎯 Your attendance boost is active for *${benefits.attendanceBoostSubjectName}*.`);
        }

        let planData = await this.getUserPlan(chatId);

        if (planData.planActive && planData.planExpiresAt && new Date() < new Date(planData.planExpiresAt)) {
            const daysLeft = Math.ceil((new Date(planData.planExpiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            let message = `🌟 You have an active *${planData.planDetails.name}* program! It expires in ${daysLeft} days.`;
            if (planData.planDetails.attendanceFocus) {
                message += ` We're committed to getting your attendance to *${planData.planDetails.targetPercentage}%*!`;
            }
            statusMessages.push(message);
        } else if (planData.planActive) {
            await this.deactivatePlan(chatId);
            planData = await this.getUserPlan(chatId);
            const remaining = FREE_LIMIT - planData.attendanceChecksUsed;
            statusMessages.push(`🚫 Your *${planData.planDetails ? planData.planDetails.name : 'premium'}* program has expired. You now have *${remaining} free checks* remaining.`);
        } else {
            if (statusMessages.length === 0) {
                const remaining = FREE_LIMIT - planData.attendanceChecksUsed;
                if (remaining > 0) {
                    statusMessages.push(`🆓 You have *${remaining} free attendance checks* remaining.`);
                } else {
                    statusMessages.push(`🚫 You've used all your free attendance checks. Please consider purchasing a program for guaranteed attendance improvement.`);
                }
            }
        }

        if (statusMessages.length > 0) {
            return statusMessages.join('\n\n');
        } else {
            return `Welcome! Use \`/plans\` to explore attendance programs or \`/invite\` to earn benefits!`;
        }
    }

    getPlansMessage() {
        let message = "🚀 **Boost Your Attendance to 90% and Beyond!**\n\nChoose a program to guarantee your attendance improvement:\n\n";
        for (const key in PLANS) {
            const plan = PLANS[key];
            message += `*${plan.name}* (${plan.price} Rs):\n  - ${plan.description}\n  - Reply with \`/buy ${key}\` to enroll.\n\n`;
        }
        message += "Type `/status` to check your current program details.\n";
        message += "You can also perform *5 free attendance checks* to see how it works!";
        message += "\n\n✨ *New!* Use \`/invite\` to earn unlimited checks and attendance boosts!";
        return message;
    }

    async activatePlan(chatId, planKey) {
        let planData = await this.getUserPlan(chatId);
        const plan = PLANS[planKey];

        if (!plan) {
            console.error(`Invalid plan key ${planKey} for chat ${chatId}`);
            return false;
        }

        const success = true;

        if (success) {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + plan.durationDays);

            planData.attendanceChecksUsed = 0;
            planData.planActive = true;
            planData.planExpiresAt = expiryDate.toISOString();
            planData.planDetails = plan;
            planData.hiddenFeatureUnlocked = true;

            await this.saveUserPlan(planData);
            console.log(`User ${chatId} successfully activated plan: ${plan.name}. Expires: ${expiryDate}`);
            return true;
        }
        return false;
    }

    async deactivatePlan(chatId) {
        let planData = await this.getUserPlan(chatId);
        if (planData.planActive) {
            planData.planActive = false;
            planData.planExpiresAt = null;
            planData.planDetails = null;
            planData.hiddenFeatureUnlocked = false;
            planData.attendanceChecksUsed = 0;
            await this.saveUserPlan(planData);
            console.log(`Plan deactivated for user ${chatId}`);
        }
    }

    async isHiddenFeatureUnlocked(chatId, featureId) {
        const planData = await this.getUserPlan(chatId);
        return planData.hiddenFeatureUnlocked && planData.planDetails && planData.planDetails.hiddenFeature === featureId;
    }

    getPlanDetails(planKey) {
        return PLANS[planKey];
    }
}

export default DBManager;