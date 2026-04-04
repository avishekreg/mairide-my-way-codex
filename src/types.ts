export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'consumer' | 'driver' | 'admin';
  status: 'active' | 'inactive';
  phoneNumber?: string;
  photoURL?: string;
  onboardingComplete: boolean;
  createdAt?: string;
  adminRole?: 'super_admin' | 'support' | 'finance' | 'compliance';
  verificationStatus?: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  verifiedBy?: string;
  referralCode?: string;
  forcePasswordChange?: boolean;
  temporaryPassword?: string;
  referredBy?: string;
  referralPath?: string[]; // Chain of referrers: [Tier 1, Tier 2]
  consents?: {
    truthfulInformationAccepted: boolean;
    termsAccepted: boolean;
    marketingOptIn: boolean;
    acceptedAt: string;
    disclosureVersion: string;
    channels: {
      email: boolean;
      sms: boolean;
      whatsapp: boolean;
    };
  };
  wallet?: {
    balance: number; // MaiCoins
    pendingBalance: number; // Coins from referrals not yet "ready"
  };
  reviewStats?: {
    averageRating: number;
    ratingCount: number;
    lastReviewAt?: string;
  };
  location?: {
    lat: number;
    lng: number;
    lastUpdated: string;
  };
  driverDetails?: {
    aadhaarNumber: string;
    aadhaarFrontPhoto: string;
    aadhaarFrontGeoTag?: { lat: number; lng: number; timestamp: number };
    aadhaarBackPhoto: string;
    aadhaarBackGeoTag?: { lat: number; lng: number; timestamp: number };
    aadhaarGeoTag?: { lat: number; lng: number; timestamp: number };
    dlNumber: string;
    dlFrontPhoto: string;
    dlFrontGeoTag?: { lat: number; lng: number; timestamp: number };
    dlBackPhoto: string;
    dlBackGeoTag?: { lat: number; lng: number; timestamp: number };
    dlGeoTag?: { lat: number; lng: number; timestamp: number };
    selfiePhoto: string;
    selfieGeoTag?: { lat: number; lng: number; timestamp: number };
    vehicleMake: string;
    vehicleModel: string;
    vehicleColor: string;
    vehicleCapacity: number;
    vehicleRegNumber: string;
    insuranceStatus?: 'active' | 'expired';
    insuranceProvider?: string;
    insuranceExpiryDate?: string;
    vehiclePhoto: string;
    vehicleGeoTag?: { lat: number; lng: number; timestamp: number };
    rcPhoto: string;
    rcGeoTag?: { lat: number; lng: number; timestamp: number };
    declarationAccepted?: boolean;
    isOnline: boolean;
    rating: number;
    totalEarnings: number;
  };
}

export interface Transaction {
  id: string;
  userId: string;
  type: 'referral_bonus' | 'referral_tier2' | 'maintenance_fee_payment' | 'fintech_payment' | 'wallet_topup' | 'ride_completion_bonus';
  amount: number;
  currency: 'INR' | 'MAICOIN';
  status: 'pending' | 'completed' | 'failed';
  description: string;
  relatedId?: string; // e.g., bookingId or referralId
  createdAt: string;
  metadata?: any; // For fintech details (GST, API response, etc.)
}

export interface Referral {
  id: string;
  referrerId: string;
  referredId: string;
  tier: 1 | 2;
  status: 'joined' | 'ride_started' | 'fee_paid';
  rewardAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  message: string;
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
  responses?: {
    senderId: string;
    senderName: string;
    message: string;
    createdAt: string;
  }[];
  feedback?: {
    rating: number;
    tags: string[];
    comment?: string;
    createdAt: string;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Ride {
  id: string;
  driverId: string;
  driverName: string;
  driverPhotoUrl?: string;
  driverRating?: number;
  origin: string;
  destination: string;
  departureTime: string;
  departureDay?: 'today' | 'tomorrow' | 'dayAfter';
  departureDayLabel?: string;
  departureClock?: string;
  departureNote?: string;
  price: number;
  seatsAvailable: number;
  status: 'available' | 'full' | 'completed' | 'cancelled';
  createdAt: string;
}

export interface AppConfig {
  id: string;
  upiId?: string;
  qrCodeUrl?: string;
  maintenanceFeeBase: number;
  gstRate: number;
  referralRewardTier1: number;
  referralRewardTier2: number;
  paymentGatewayUrl?: string;
  paymentGatewayApiKey?: string;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayWebhookSecret?: string;
  smsApiUrl?: string;
  smsApiKey?: string;
  twoFactorApiKey?: string;
  smsOtpProvider?: '2factor' | 'custom';
  smsTemplateName?: string;
  emailApiUrl?: string;
  emailApiKey?: string;
  emailOtpEnabled?: boolean;
  emailOtpProvider?: 'disabled' | '2factor' | 'resend';
  resendApiBaseUrl?: string;
  resendApiKey?: string;
  resendFromEmail?: string;
  resendFromName?: string;
  resendReplyToEmail?: string;
  emailOtpExpiryMinutes?: number;
  emailOtpSubject?: string;
  chatbotEnabled?: boolean;
  llmProvider?: 'gemini' | 'openai' | 'claude' | 'disabled';
  llmModel?: string;
  chatbotSystemPrompt?: string;
  chatbotTemperature?: number;
  chatbotMaxTokens?: number;
  chatbotFallbackMessage?: string;
  chatbotDefaultLanguage?: string;
  chatbotVoiceOutputEnabled?: boolean;
  chatbotVoiceInputEnabled?: boolean;
  chatbotTtsRate?: number;
  chatbotTtsPitch?: number;
  geminiApiKey?: string;
  geminiProjectId?: string;
  openaiApiKey?: string;
  openaiProjectId?: string;
  openaiOrgId?: string;
  claudeApiKey?: string;
  appBaseUrl?: string;
  publicApiBaseUrl?: string;
  supportEmail?: string;
  supportPhone?: string;
  environmentLabel?: string;
  superAdminEmail?: string;
  appVersion?: string;
  supabaseProjectUrl?: string;
  storageBucket?: string;
  googleMapsApiKey?: string;
  n8nBaseUrl?: string;
  n8nApiKey?: string;
  n8nSharedSecret?: string;
  n8nOtpWebhookUrl?: string;
  n8nPaymentWebhookUrl?: string;
  n8nBookingWebhookUrl?: string;
  n8nChatWebhookUrl?: string;
  n8nSupportWebhookUrl?: string;
  n8nUserWebhookUrl?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Booking {
  id: string;
  rideId: string;
  consumerId: string;
  consumerName: string;
  consumerPhone?: string;
  driverId: string;
  driverName: string;
  driverPhotoUrl?: string;
  driverPhone?: string;
  origin: string;
  destination: string;
  listedOrigin?: string;
  listedDestination?: string;
  requestedOrigin?: string;
  requestedDestination?: string;
  requiresDetour?: boolean;
  fare: number;
  seatsBooked: number;
  totalPrice: number;
  serviceFee: number;
  gstAmount: number; // GST on fee
  maiCoinsUsed: number;
  driverFeePaid?: boolean;
  driverMaiCoinsUsed?: number;
  feePaid?: boolean;
  paymentStatus?: 'pending' | 'proof_submitted' | 'paid' | 'failed';
  consumerPaymentMode?: 'maicoins' | 'online' | 'hybrid';
  driverPaymentMode?: 'maicoins' | 'online' | 'hybrid';
  consumerPaymentTransactionId?: string;
  driverPaymentTransactionId?: string;
  consumerPaymentOrderId?: string;
  driverPaymentOrderId?: string;
  consumerPaymentGateway?: 'manual' | 'razorpay';
  driverPaymentGateway?: 'manual' | 'razorpay';
  consumerPaymentReceiptUrl?: string;
  driverPaymentReceiptUrl?: string;
  consumerPaymentMetadata?: Record<string, any>;
  driverPaymentMetadata?: Record<string, any>;
  consumerPaymentSubmittedAt?: string;
  driverPaymentSubmittedAt?: string;
  negotiatedFare?: number;
  negotiationStatus?: 'pending' | 'accepted' | 'rejected';
  negotiationActor?: 'consumer' | 'driver';
  driverCounterPending?: boolean;
  rideLifecycleStatus?: 'awaiting_start_otp' | 'in_progress' | 'completed';
  rideStartOtp?: string;
  rideStartOtpGeneratedAt?: string;
  rideStartOtpVerifiedAt?: string;
  rideEndOtp?: string;
  rideEndOtpGeneratedAt?: string;
  rideEndOtpVerifiedAt?: string;
  rideStartedAt?: string;
  rideEndedAt?: string;
  driverEarningsCreditedAt?: string;
  completionBonusGrantedAt?: string;
  consumerReview?: {
    rating: number;
    comment?: string;
    traits?: string[];
    createdAt: string;
  };
  driverReview?: {
    rating: number;
    comment?: string;
    traits?: string[];
    createdAt: string;
  };
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'negotiating' | 'rejected';
  createdAt: string;
}
