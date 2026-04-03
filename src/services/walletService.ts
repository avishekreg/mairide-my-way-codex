import { 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  increment, 
  serverTimestamp,
  runTransaction
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserProfile, Referral, Transaction } from '../types';

export const DRIVER_JOINING_BONUS = 500;
export const TRAVELER_JOINING_BONUS = 250;
export const MAX_MAICOINS_PER_RIDE = 25;
export const TIER1_REWARD = 25; // Direct referral
export const TIER2_REWARD = 5; // Indirect referral (Tier 2)

export const walletService = {
  /**
   * Generate a unique referral code
   */
  async generateUniqueReferralCode(): Promise<string> {
    let code = '';
    let isUnique = false;
    while (!isUnique) {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const q = query(collection(db, 'users'), where('referralCode', '==', code));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        isUnique = true;
      }
    }
    return code;
  },

  /**
   * Initialize a new user's wallet and referral code
   */
  async initializeUserWallet(userId: string, referrerCode?: string) {
    const referralCode = await this.generateUniqueReferralCode();
    
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? (userSnap.data() as UserProfile) : null;
    const joiningBonus = userData?.role === 'driver' ? DRIVER_JOINING_BONUS : TRAVELER_JOINING_BONUS;
    
    let referredBy = null;
    let referralPath: string[] = [];

    if (referrerCode) {
      const q = query(collection(db, 'users'), where('referralCode', '==', referrerCode));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const referrerDoc = querySnapshot.docs[0];
        const referrerId = referrerDoc.id;
        const referrerData = referrerDoc.data() as UserProfile;
        
        referredBy = referrerId;
        // New user's path is [Referrer, ...Referrer's Path]
        referralPath = [referrerId, ...(referrerData.referralPath || [])].slice(0, 2);
      }
    }

    await updateDoc(userRef, {
      referralCode,
      referredBy,
      referralPath,
      wallet: {
        balance: joiningBonus,
        pendingBalance: 0
      }
    });

    // Create initial top-up transaction
    const txId = `init_${userId}`;
    await setDoc(doc(db, 'transactions', txId), {
      id: txId,
      userId,
      type: 'wallet_topup',
      amount: joiningBonus,
      currency: 'MAICOIN',
      status: 'completed',
      description: userData?.role === 'driver' ? 'Driver joining bonus' : 'Traveler joining bonus',
      createdAt: new Date().toISOString()
    });

    if (referredBy) {
      await this.handleReferral(userId, referralPath);
    }
  },

  /**
   * Handle the referral logic when a new user joins
   */
  async handleReferral(newUserId: string, referralPath: string[]) {
    // Fetch config for dynamic rewards
    const configSnap = await getDoc(doc(db, 'app_config', 'global'));
    const config = configSnap.exists() ? configSnap.data() : null;
    const tier1Reward = config?.referralRewardTier1 ?? 50;
    const tier2Reward = config?.referralRewardTier2 ?? 25;
    const rewards = [tier1Reward, tier2Reward];

    for (let i = 0; i < referralPath.length; i++) {
      const referrerId = referralPath[i];
      const tier = (i + 1) as 1 | 2;
      const rewardAmount = rewards[i];

      const refId = `ref${tier}_${referrerId}_${newUserId}`;
      await setDoc(doc(db, 'referrals', refId), {
        id: refId,
        referrerId,
        referredId: newUserId,
        tier,
        status: 'joined',
        rewardAmount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  },

  /**
   * Update referral status and pending balance when a ride starts
   */
  async onRideStart(userId: string) {
    const q = query(collection(db, 'referrals'), where('referredId', '==', userId), where('status', '==', 'joined'));
    const querySnapshot = await getDocs(q);

    for (const referralDoc of querySnapshot.docs) {
      const referral = referralDoc.data() as Referral;
      
      await updateDoc(doc(db, 'referrals', referral.id), {
        status: 'ride_started',
        updatedAt: new Date().toISOString()
      });

      // Update referrer's pending balance
      await updateDoc(doc(db, 'users', referral.referrerId), {
        'wallet.pendingBalance': increment(referral.rewardAmount)
      });
    }
  },

  /**
   * Finalize referral reward when maintenance fee is paid
   */
  async onMaintenanceFeePaid(userId: string, bookingId: string) {
    // Fetch the booking to check if MaiCoins were used
    const bookingRef = doc(db, 'bookings', bookingId);
    const bookingSnap = await getDoc(bookingRef);
    
    if (!bookingSnap.exists()) return;
    
    const bookingData = bookingSnap.data();
    const isConsumer = bookingData.consumerId === userId;
    const isDriver = bookingData.driverId === userId;
    
    // Logic: No referral credits if even 1 MaiCoin was used for the fee
    const maiCoinsUsed = isConsumer ? (bookingData.maiCoinsUsed || 0) : (isDriver ? (bookingData.driverMaiCoinsUsed || 0) : 0);
    
    if (maiCoinsUsed > 0) {
      console.log(`User ${userId} used ${maiCoinsUsed} MaiCoins for booking ${bookingId}. Skipping referral rewards.`);
      
      // We still need to clean up the pending balance if it was added during onRideStart
      const q = query(collection(db, 'referrals'), where('referredId', '==', userId), where('status', '==', 'ride_started'));
      const querySnapshot = await getDocs(q);

      for (const referralDoc of querySnapshot.docs) {
        const referral = referralDoc.data() as Referral;
        await runTransaction(db, async (transaction) => {
          const referrerRef = doc(db, 'users', referral.referrerId);
          transaction.update(referrerRef, {
            'wallet.pendingBalance': increment(-referral.rewardAmount)
          });
          transaction.update(doc(db, 'referrals', referral.id), {
            status: 'cancelled_maicoin_used',
            updatedAt: new Date().toISOString()
          });
        });
      }
      return;
    }

    const q = query(collection(db, 'referrals'), where('referredId', '==', userId), where('status', '==', 'ride_started'));
    const querySnapshot = await getDocs(q);

    for (const referralDoc of querySnapshot.docs) {
      const referral = referralDoc.data() as Referral;

      await runTransaction(db, async (transaction) => {
        const referrerRef = doc(db, 'users', referral.referrerId);
        const referrerSnap = await transaction.get(referrerRef);
        
        if (!referrerSnap.exists()) return;

        // Move from pending to actual balance
        transaction.update(referrerRef, {
          'wallet.balance': increment(referral.rewardAmount),
          'wallet.pendingBalance': increment(-referral.rewardAmount)
        });

        // Update referral status
        transaction.update(doc(db, 'referrals', referral.id), {
          status: 'fee_paid',
          updatedAt: new Date().toISOString()
        });

        // Create reward transaction
        const txId = `reward_${referral.id}`;
        let txType: Transaction['type'] = 'referral_bonus';
        if (referral.tier === 2) txType = 'referral_tier2';

        transaction.set(doc(db, 'transactions', txId), {
          id: txId,
          userId: referral.referrerId,
          type: txType,
          amount: referral.rewardAmount,
          currency: 'MAICOIN',
          status: 'completed',
          description: `Referral reward (Tier ${referral.tier}) for user ${userId}`,
          relatedId: bookingId,
          createdAt: new Date().toISOString()
        });
      });
    }
  },

  /**
   * Get referral statistics for a user
   */
  async getReferralStats(userId: string) {
    const q = query(collection(db, 'referrals'), where('referrerId', '==', userId));
    const querySnapshot = await getDocs(q);
    
    const stats = {
      tier1: 0,
      tier2: 0,
      totalEarned: 0,
      pending: 0
    };

    querySnapshot.forEach((doc) => {
      const referral = doc.data() as Referral;
      if (referral.tier === 1) stats.tier1++;
      else if (referral.tier === 2) stats.tier2++;

      if (referral.status === 'fee_paid') {
        stats.totalEarned += referral.rewardAmount;
      } else {
        stats.pending += referral.rewardAmount;
      }
    });

    return stats;
  },

  /**
   * Process a generic transaction
   */
  async processTransaction(userId: string, data: { amount: number, type: 'credit' | 'debit', description: string, bookingId?: string }) {
    return await runTransaction(db, async (transaction) => {
      const userRef = doc(db, 'users', userId);
      const userSnap = await transaction.get(userRef);
      
      if (!userSnap.exists()) throw new Error('User not found');
      
      const userData = userSnap.data() as UserProfile;
      const currentBalance = userData.wallet?.balance || 0;

      if (data.type === 'debit' && currentBalance < data.amount) {
        throw new Error('Insufficient balance');
      }

      const newBalance = data.type === 'credit' ? currentBalance + data.amount : currentBalance - data.amount;

      transaction.update(userRef, {
        'wallet.balance': newBalance
      });

      const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      transaction.set(doc(db, 'transactions', txId), {
        id: txId,
        userId,
        type: data.type === 'credit' ? 'wallet_topup' : 'maintenance_fee_payment',
        amount: data.amount,
        currency: 'MAICOIN',
        status: 'completed',
        description: data.description,
        relatedId: data.bookingId,
        createdAt: new Date().toISOString()
      });

      return true;
    });
  },

  /**
   * Use MaiCoins to pay for a fee
   */
  async useMaiCoins(userId: string, amount: number, bookingId: string) {
    return await runTransaction(db, async (transaction) => {
      const userRef = doc(db, 'users', userId);
      const userSnap = await transaction.get(userRef);
      
      if (!userSnap.exists()) throw new Error('User not found');
      
      const userData = userSnap.data() as UserProfile;
      if ((userData.wallet?.balance || 0) < amount) {
        throw new Error('Insufficient MaiCoins');
      }

      transaction.update(userRef, {
        'wallet.balance': increment(-amount)
      });

      const txId = `pay_${bookingId}_${Date.now()}`;
      transaction.set(doc(db, 'transactions', txId), {
        id: txId,
        userId,
        type: 'maintenance_fee_payment',
        amount: amount,
        currency: 'MAICOIN',
        status: 'completed',
        description: `Paid maintenance fee for booking ${bookingId}`,
        relatedId: bookingId,
        createdAt: new Date().toISOString()
      });

      return true;
    });
  },
};
