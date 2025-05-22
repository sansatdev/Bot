 // planManager.js
import sqlite3 from 'sqlite3'; // Changed from require
const DB_PATH = './w3s-dynamic-storage/database.db';

const PLANS = {
    '1_month': {
        name: '1 Month Unlimited',
        price: 500,
        durationDays: 30,
        hiddenFeature: 'exclusive_report',
        description: 'Unlimited attendance checks for 1 month + Exclusive Report.'
    },
    '3_months': {
        name: '3 Months Unlimited',
        price: 1200,
        durationDays: 90,
        hiddenFeature: 'priority_support',
        description: 'Unlimited attendance checks for 3 months + Priority Support.'
    },
    '6_months': {
        name: '6 Months Unlimited',
        price: 2000,
        durationDays: 180,
        hiddenFeature: 'pro_analytics',
        description: 'Unlimited attendance checks for 6 months + Pro Analytics Dashboard.'
    }
};

const FREE_LIMIT = 5; // Max free attendance checks

class PlanManager {
    constructor() {
        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('❌ Could not connect to SQLite database:', err.message);
            } else {
                console.log('✅ Connected to SQLite database.');
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
            }
        });
    }

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

    async canPerformCheck(chatId) {
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
        let planData = await this.getUserPlan(chatId);
        if (!planData.planActive) {
            planData.attendanceChecksUsed++;
            await this.saveUserPlan(planData);
            console.log(`User ${chatId} used a free check. Total: ${planData.attendanceChecksUsed}`);
        }
    }

    async getUsageStatus(chatId) {
        let planData = await this.getUserPlan(chatId);

        if (planData.planActive && planData.planExpiresAt && new Date() < new Date(planData.planExpiresAt)) {
            const daysLeft = Math.ceil((new Date(planData.planExpiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            return `🌟 You have an active *${planData.planDetails.name}* plan! It expires in ${daysLeft} days. Enjoy unlimited checks!`;
        } else if (planData.planActive) {
            await this.deactivatePlan(chatId);
            planData = await this.getUserPlan(chatId);
            const remaining = FREE_LIMIT - planData.attendanceChecksUsed;
            return `🚫 Your *${planData.planDetails ? planData.planDetails.name : 'premium'}* plan has expired. You now have *${remaining} free checks* remaining.`;
        } else {
            const remaining = FREE_LIMIT - planData.attendanceChecksUsed;
            if (remaining > 0) {
                return `🆓 You have *${remaining} free attendance checks* remaining.`;
            } else {
                return `🚫 You have used all your free attendance checks. Please consider purchasing a plan for unlimited access.`;
            }
        }
    }

    getPlansMessage() {
        let message = "🚀 Unlock Unlimited Attendance Checks!\n\nChoose a plan for uninterrupted service:\n\n";
        for (const key in PLANS) {
            const plan = PLANS[key];
            message += `*${plan.name}* (${plan.price} Rs):\n  - ${plan.description}\n  - Reply with \`/buy ${key}\` to purchase.\n\n`;
        }
        message += "Type `/status` to check your current usage and plan details.";
        return message;
    }

    async activatePlan(chatId, planKey) {
        let planData = await this.getUserPlan(chatId);
        const plan = PLANS[planKey];

        if (!plan) {
            console.error(`Invalid plan key ${planKey} for chat ${chatId}`);
            return false;
        }

        const success = true; // Simulate successful payment

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

export default PlanManager; // Changed from module.exports