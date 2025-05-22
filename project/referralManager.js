 // referralManager.js
import sqlite3 from 'sqlite3';

const DB_PATH = './w3s-dynamic-storage/database.db';

const DEFAULT_REFERRAL_REWARD_TYPE = 'free_checks';
const DEFAULT_REFERRAL_REWARD_AMOUNT = 3; // e.g., 3 free attendance checks

class ReferralManager {
    constructor(dbManager) {
        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('❌ Could not connect to SQLite database for ReferralManager:', err.message);
            } else {
                console.log('✅ Connected to SQLite database for ReferralManager.');
                this.db.serialize(() => {
                    // Table for tracking all users (for uniqueness check)
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS users (
                            chatId TEXT PRIMARY KEY,
                            first_seen_at TEXT NOT NULL,
                            unique_device_id TEXT -- Placeholder for more robust abuse prevention
                        )
                    `, (createErr) => {
                        if (createErr) console.error('❌ Error creating users table:', createErr.message);
                        else console.log('✅ Users table ensured.');
                    });

                    // Table for storing referral events
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS referrals (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            referrerId TEXT NOT NULL,
                            referredUserId TEXT NOT NULL UNIQUE, -- Ensures a user can only be referred once
                            timestamp TEXT NOT NULL,
                            rewardStatus TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'rewarded', 'revoked'
                            rewardAmount INTEGER,
                            rewardType TEXT,
                            FOREIGN KEY (referrerId) REFERENCES users(chatId),
                            FOREIGN KEY (referredUserId) REFERENCES users(chatId)
                        )
                    `, (createErr) => {
                        if (createErr) console.error('❌ Error creating referrals table:', createErr.message);
                        else console.log('✅ Referrals table ensured.');
                    });

                    // Table for configurable settings (e.g., reward amount)
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS settings (
                            key TEXT PRIMARY KEY,
                            value TEXT
                        )
                    `, (createErr) => {
                        if (createErr) {
                            console.error('❌ Error creating settings table:', createErr.message);
                        } else {
                            console.log('✅ Settings table ensured.');
                            // Insert default reward settings if they don't exist
                            this.db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
                                ['referral_reward_type', DEFAULT_REFERRAL_REWARD_TYPE], (err) => {
                                    if (err) console.error('Error inserting default reward type:', err.message);
                                });
                            this.db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
                                ['referral_reward_amount', DEFAULT_REFERRAL_REWARD_AMOUNT.toString()], (err) => {
                                    if (err) console.error('Error inserting default reward amount:', err.message);
                                });
                        }
                    });
                });
            }
        });
        this.dbManager = dbManager; // Reference to DBManager for interacting with user_plans
    }

    async getSetting(key) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
                if (err) {
                    console.error(`❌ Error getting setting ${key}:`, err.message);
                    reject(err);
                } else {
                    resolve(row ? row.value : null);
                }
            });
        });
    }

    async setSetting(key, value) {
        return new Promise((resolve, reject) => {
            this.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value], (err) => {
                if (err) {
                    console.error(`❌ Error setting ${key}:`, err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    // Record a new user's first interaction
    async recordUser(chatId, uniqueDeviceId = null) {
        return new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString();
            this.db.run(`INSERT OR IGNORE INTO users (chatId, first_seen_at, unique_device_id) VALUES (?, ?, ?)`,
                [chatId, timestamp, uniqueDeviceId],
                function(err) {
                    if (err) {
                        console.error(`❌ Error recording user ${chatId}:`, err.message);
                        reject(err);
                    } else {
                        resolve(this.changes > 0); // True if new user, false if already exists
                    }
                }
            );
        });
    }

    // Check if a user has been seen before
    async isNewUser(chatId) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT COUNT(*) as count FROM users WHERE chatId = ?`, [chatId], (err, row) => {
                if (err) {
                    console.error(`❌ Error checking if user ${chatId} is new:`, err.message);
                    reject(err);
                } else {
                    resolve(row.count === 0);
                }
            });
        });
    }

    // Check if a referral already exists for this referred user
    async hasBeenReferred(referredUserId) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT COUNT(*) as count FROM referrals WHERE referredUserId = ?`, [referredUserId], (err, row) => {
                if (err) {
                    console.error(`❌ Error checking if user ${referredUserId} has been referred:`, err.message);
                    reject(err);
                } else {
                    resolve(row.count > 0);
                }
            });
        });
    }

    // Record a referral attempt and process reward
    async recordReferral(referrerId, referredUserId) {
        // Prevent self-referral
        if (referrerId === referredUserId) {
            return { success: false, message: "Self-referral is not allowed." };
        }

        // Check if referred user is truly new to the bot (hasn't sent /start before)
        const isNewUser = await this.isNewUser(referredUserId);
        if (!isNewUser) {
            return { success: false, message: "This user has already interacted with the bot and cannot be referred." };
        }

        // Check if referred user has already been recorded as referred by *anyone*
        const alreadyReferred = await this.hasBeenReferred(referredUserId);
        if (alreadyReferred) {
            return { success: false, message: "This user has already been referred." };
        }

        return new Promise(async (resolve, reject) => {
            const timestamp = new Date().toISOString();
            const rewardType = await this.getSetting('referral_reward_type') || DEFAULT_REFERRAL_REWARD_TYPE;
            const rewardAmount = parseInt(await this.getSetting('referral_reward_amount') || DEFAULT_REFERRAL_REWARD_AMOUNT, 10);

            this.db.run(`INSERT INTO referrals (referrerId, referredUserId, timestamp, rewardStatus, rewardAmount, rewardType) VALUES (?, ?, ?, ?, ?, ?)`,
                [referrerId, referredUserId, timestamp, 'pending', rewardAmount, rewardType],
                async function(err) {
                    if (err) {
                        console.error(`❌ Error recording referral from ${referrerId} to ${referredUserId}:`, err.message);
                        resolve({ success: false, message: "Failed to record referral." });
                    } else {
                        // If insertion was successful, attempt to reward the referrer
                        const referralId = this.lastID;
                        try {
                            const rewardSuccess = await this.rewardReferrer(referrerId, referredUserId, rewardType, rewardAmount, referralId);
                            if (rewardSuccess) {
                                resolve({ success: true, message: `Referral successful! You earned ${rewardAmount} ${rewardType}.` });
                            } else {
                                resolve({ success: false, message: "Referral recorded, but reward could not be applied. Please contact support." });
                            }
                        } catch (rewardErr) {
                            console.error(`❌ Error applying reward for referral ${referralId}:`, rewardErr.message);
                            resolve({ success: false, message: "Referral recorded, but an error occurred while applying reward." });
                        }
                    }
                }
            );
        });
    }

    async rewardReferrer(referrerId, referredUserId, rewardType, rewardAmount, referralDbId) {
        try {
            if (rewardType === 'free_checks') {
                const userPlan = await this.dbManager.getUserPlan(referrerId);
                userPlan.attendanceChecksUsed -= rewardAmount; // Decrement used checks (effectively adding free checks)
                if (userPlan.attendanceChecksUsed < 0) {
                    userPlan.attendanceChecksUsed = 0; // Ensure it doesn't go negative
                }
                await this.dbManager.saveUserPlan(userPlan);
                console.log(`Rewarded ${referrerId} with ${rewardAmount} free checks.`);
            } else {
                console.warn(`Unknown reward type: ${rewardType} for referrer ${referrerId}`);
                // If reward type is unknown, mark as pending and admin can manually handle
                await this.updateReferralRewardStatus(referralDbId, 'pending');
                return false;
            }

            // Update reward status in DB
            await this.updateReferralRewardStatus(referralDbId, 'rewarded');
            return true;

        } catch (error) {
            console.error(`Error rewarding referrer ${referrerId} for user ${referredUserId}:`, error.message);
            await this.updateReferralRewardStatus(referralDbId, 'failed'); // Mark as failed on error
            return false;
        }
    }

    async updateReferralRewardStatus(referralDbId, status) {
        return new Promise((resolve, reject) => {
            this.db.run(`UPDATE referrals SET rewardStatus = ? WHERE id = ?`, [status, referralDbId], (err) => {
                if (err) {
                    console.error(`❌ Error updating reward status for referral ${referralDbId}:`, err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    // Admin function: Get leaderboard
    async getLeaderboard() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT
                    referrerId,
                    COUNT(referredUserId) as total_referrals,
                    SUM(CASE WHEN rewardStatus = 'rewarded' THEN 1 ELSE 0 END) as rewarded_referrals
                FROM referrals
                WHERE rewardStatus = 'rewarded' OR rewardStatus = 'pending' -- Only count successful or pending referrals
                GROUP BY referrerId
                ORDER BY rewarded_referrals DESC, total_referrals DESC
                LIMIT 10
            `, [], (err, rows) => {
                if (err) {
                    console.error('❌ Error fetching leaderboard:', err.message);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Admin function: Reset a referral (e.g., if reward was mistakenly given or revoked)
    async resetReferral(referredUserId) {
        return new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM referrals WHERE referredUserId = ?`, [referredUserId], function(err) {
                if (err) {
                    console.error(`❌ Error resetting referral for ${referredUserId}:`, err.message);
                    reject(err);
                } else {
                    resolve(this.changes > 0); // True if a record was deleted
                }
            });
        });
    }

    // Admin function: Revoke a reward
    async revokeReferralReward(referredUserId) {
        return new Promise(async (resolve, reject) => {
            const referralInfo = await new Promise((res, rej) => {
                this.db.get(`SELECT * FROM referrals WHERE referredUserId = ?`, [referredUserId], (err, row) => {
                    if (err) rej(err);
                    else res(row);
                });
            });

            if (!referralInfo || referralInfo.rewardStatus !== 'rewarded') {
                resolve({ success: false, message: "No rewarded referral found for this user." });
                return;
            }

            // Attempt to reverse the reward
            try {
                if (referralInfo.rewardType === 'free_checks') {
                    const userPlan = await this.dbManager.getUserPlan(referralInfo.referrerId);
                    userPlan.attendanceChecksUsed += referralInfo.rewardAmount; // Add back the checks
                    await this.dbManager.saveUserPlan(userPlan);
                    console.log(`Revoked ${referralInfo.rewardAmount} free checks from ${referralInfo.referrerId}.`);
                }
                // Add more reward types reversal logic here if needed

                await this.updateReferralRewardStatus(referralInfo.id, 'revoked');
                resolve({ success: true, message: `Reward for ${referredUserId} revoked successfully.` });
            } catch (error) {
                console.error(`❌ Error revoking reward for ${referredUserId}:`, error.message);
                resolve({ success: false, message: `Failed to revoke reward: ${error.message}` });
            }
        });
    }
}

export default ReferralManager;