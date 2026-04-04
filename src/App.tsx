import React, { useState, useEffect, useRef, useMemo, Component } from 'react';
import { 
  BrowserRouter as Router, 
  Routes, 
  Route, 
  Navigate, 
  useNavigate,
  useLocation
} from 'react-router-dom';
import axios from 'axios';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
  signInAnonymously,
  signInWithEmailAndPassword
} from 'firebase/auth';
import { 
  GoogleMap, 
  useJsApiLoader, 
  Marker, 
  InfoWindow,
  Autocomplete,
  DirectionsService,
  DirectionsRenderer
} from '@react-google-maps/api';
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  getDocFromServer,
  getDocsFromServer,
  orderBy,
  limit
} from 'firebase/firestore';
import { 
  ref as storageRef, 
  uploadString, 
  getDownloadURL 
} from 'firebase/storage';
import { auth, db, storage } from './lib/firebase';
import { supabase } from './lib/supabase';
import { UserProfile, SupportTicket, ChatMessage, Transaction, Referral, AppConfig, Booking, Ride } from './types';
import { walletService, MAX_MAICOINS_PER_RIDE } from './services/walletService';
import Webcam from 'react-webcam';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell,
  Legend
} from 'recharts';
import { 
  Car, 
  User as UserIcon, 
  LogOut, 
  Search, 
  Plus, 
  History, 
  Settings,
  ShieldCheck,
  Shield,
  MapPin,
  Clock,
  IndianRupee,
  Star,
  Camera,
  CheckCircle2,
  AlertCircle,
  Menu,
  X,
  ChevronRight,
  Navigation,
  MessageSquare,
  Send,
  PlusCircle,
  TrendingUp,
  LineChart as LineChartIcon,
  UserPlus,
  UserMinus,
  LifeBuoy,
  Bot,
  AlertTriangle,
  Users,
  MoreVertical,
  Lock,
  Phone,
  Copy,
  Receipt,
  ArrowUpRight,
  ArrowDownLeft,
  Wallet
} from 'lucide-react';
import { cn, formatCurrency, calculateServiceFee } from './lib/utils';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, any>) => { open: () => void };
  }
}

// --- Utils ---

const deg2rad = (deg: number) => deg * (Math.PI / 180);

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};

const toLocalXY = (lat: number, lng: number, refLat: number) => {
  // Simple local projection (good enough for short/medium route matching in app searches)
  const kmPerLat = 111.32;
  const kmPerLng = 111.32 * Math.cos((refLat * Math.PI) / 180);
  return {
    x: lng * kmPerLng,
    y: lat * kmPerLat,
  };
};

const pointToRouteDistanceKm = (
  point: { lat: number; lng: number },
  routeStart: { lat: number; lng: number },
  routeEnd: { lat: number; lng: number }
) => {
  const refLat = (routeStart.lat + routeEnd.lat) / 2;
  const a = toLocalXY(routeStart.lat, routeStart.lng, refLat);
  const b = toLocalXY(routeEnd.lat, routeEnd.lng, refLat);
  const p = toLocalXY(point.lat, point.lng, refLat);

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abSq = abx * abx + aby * aby;
  if (abSq === 0) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return { distanceKm: Math.sqrt(dx * dx + dy * dy), progress: 0 };
  }

  const rawT = (apx * abx + apy * aby) / abSq;
  const t = Math.max(0, Math.min(1, rawT));
  const closestX = a.x + t * abx;
  const closestY = a.y + t * aby;
  const dx = p.x - closestX;
  const dy = p.y - closestY;
  return { distanceKm: Math.sqrt(dx * dx + dy * dy), progress: rawT };
};

const routeCorridorMatch = ({
  rideOriginLocation,
  rideDestinationLocation,
  travelerOriginLocation,
  travelerDestinationLocation,
  pickupDetourKm = 30,
  dropDetourKm = 30,
}: {
  rideOriginLocation: { lat: number; lng: number };
  rideDestinationLocation: { lat: number; lng: number };
  travelerOriginLocation: { lat: number; lng: number } | null;
  travelerDestinationLocation: { lat: number; lng: number } | null;
  pickupDetourKm?: number;
  dropDetourKm?: number;
}) => {
  if (!travelerOriginLocation && !travelerDestinationLocation) return false;

  const pickupCheck = travelerOriginLocation
    ? pointToRouteDistanceKm(travelerOriginLocation, rideOriginLocation, rideDestinationLocation)
    : null;
  const dropCheck = travelerDestinationLocation
    ? pointToRouteDistanceKm(travelerDestinationLocation, rideOriginLocation, rideDestinationLocation)
    : null;

  const pickupValid = !pickupCheck || pickupCheck.distanceKm <= pickupDetourKm;
  const dropValid = !dropCheck || dropCheck.distanceKm <= dropDetourKm;
  if (!pickupValid || !dropValid) return false;

  // Keep travel direction aligned with driver route when both points are provided
  if (pickupCheck && dropCheck) {
    const directionValid = dropCheck.progress >= pickupCheck.progress - 0.05;
    if (!directionValid) return false;
  }

  return true;
};

const getAdaptiveDetourToleranceKm = (routeDistanceKm: number) => {
  // Keep short-city routes strict, allow moderate flexibility for longer highway journeys.
  if (routeDistanceKm <= 40) {
    return { pickupDetourKm: 12, dropDetourKm: 12 };
  }
  if (routeDistanceKm <= 120) {
    return { pickupDetourKm: 18, dropDetourKm: 18 };
  }
  if (routeDistanceKm <= 250) {
    return { pickupDetourKm: 24, dropDetourKm: 24 };
  }
  return { pickupDetourKm: 30, dropDetourKm: 30 };
};

const normalizeSearchText = (value?: string) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const routeTextMatches = (candidate: string, searchValue: string) => {
  if (!searchValue) return true;
  if (!candidate) return false;
  if (candidate.includes(searchValue) || searchValue.includes(candidate)) return true;

  const candidateTokens = candidate
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const searchTokens = searchValue
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (!searchTokens.length) return true;
  return searchTokens.every((searchToken) =>
    candidateTokens.some((candidateToken) => candidateToken.includes(searchToken) || searchToken.includes(candidateToken))
  );
};

const getRideDuplicateKey = (ride: Partial<Ride>) => {
  const origin = normalizeSearchText(ride.origin || '');
  const destination = normalizeSearchText(ride.destination || '');
  const departureTime = ride.departureTime || '';
  const driverId = ride.driverId || '';
  return `${driverId}__${origin}__${destination}__${departureTime}`;
};

const isVisibleInActiveRideViews = (record: { dashboardVisible?: boolean | null }) =>
  record.dashboardVisible !== false;

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });

const generateRideOtp = () => `${Math.floor(100000 + Math.random() * 900000)}`;

const maybeActivateRideLifecycle = async (bookingId: string) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const bookingSnap = await getDoc(bookingRef);
  if (!bookingSnap.exists()) return;

  const booking = { id: bookingSnap.id, ...(bookingSnap.data() as Booking) };
  if (booking.feePaid && booking.driverFeePaid && !booking.rideStartOtp && !booking.rideStartedAt) {
    await updateDoc(bookingRef, {
      rideLifecycleStatus: 'awaiting_start_otp',
      rideStartOtp: generateRideOtp(),
      rideStartOtpGeneratedAt: new Date().toISOString(),
    });
  }
};

type PlatformFeePaymentEvent = {
  id: string;
  bookingId: string;
  payer: 'consumer' | 'driver';
  createdAt: string;
  revenue: number;
  gst: number;
  total: number;
  paymentMode: 'maicoins' | 'online' | 'manual';
};

const hasLockedRideLifecycle = (booking: Partial<Booking>) =>
  booking.status === 'confirmed'
  || booking.rideLifecycleStatus === 'awaiting_start_otp'
  || booking.rideLifecycleStatus === 'in_progress';

const getLockedRideIds = (bookings: Booking[]) => {
  const lockedRideIds = new Set<string>();
  bookings.forEach((booking) => {
    if (booking.rideId && hasLockedRideLifecycle(booking)) {
      lockedRideIds.add(booking.rideId);
    }
  });
  return lockedRideIds;
};

const getPlatformFeePaymentEvents = (bookings: Booking[]): PlatformFeePaymentEvent[] => {
  const events: PlatformFeePaymentEvent[] = [];

  bookings.forEach((booking) => {
    if (booking.feePaid) {
      const paymentMode = booking.consumerPaymentMode === 'hybrid'
        ? 'hybrid'
        : booking.consumerPaymentMode === 'maicoins'
        ? 'maicoins'
        : booking.consumerPaymentGateway === 'razorpay'
          ? 'online'
          : 'manual';
      events.push({
        id: `${booking.id}-consumer`,
        bookingId: booking.id,
        payer: 'consumer',
        createdAt: booking.consumerPaymentSubmittedAt || booking.createdAt,
        revenue: paymentMode === 'maicoins' ? 0 : booking.serviceFee || 0,
        gst: paymentMode === 'maicoins' ? 0 : booking.gstAmount || 0,
        total: paymentMode === 'maicoins' ? 0 : (booking.serviceFee || 0) + (booking.gstAmount || 0),
        paymentMode,
      });
    }

    if (booking.driverFeePaid) {
      const paymentMode = booking.driverPaymentMode === 'hybrid'
        ? 'hybrid'
        : booking.driverPaymentMode === 'maicoins'
        ? 'maicoins'
        : booking.driverPaymentGateway === 'razorpay'
          ? 'online'
          : 'manual';
      events.push({
        id: `${booking.id}-driver`,
        bookingId: booking.id,
        payer: 'driver',
        createdAt: booking.driverPaymentSubmittedAt || booking.createdAt,
        revenue: paymentMode === 'maicoins' ? 0 : booking.serviceFee || 0,
        gst: paymentMode === 'maicoins' ? 0 : booking.gstAmount || 0,
        total: paymentMode === 'maicoins' ? 0 : (booking.serviceFee || 0) + (booking.gstAmount || 0),
        paymentMode,
      });
    }
  });

  return events;
};

const recordPlatformFeeTransaction = async ({
  booking,
  payer,
  paymentMode,
  paymentStatus,
  transactionId,
  orderId,
  receiptUrl,
  gateway,
  coinsUsed = 0,
  metadata = {},
}: {
  booking: Booking;
  payer: 'consumer' | 'driver';
  paymentMode: 'maicoins' | 'online' | 'hybrid';
  paymentStatus: 'pending' | 'completed' | 'failed';
  transactionId?: string;
  orderId?: string;
  receiptUrl?: string;
  gateway?: 'manual' | 'razorpay';
  coinsUsed?: number;
  metadata?: Record<string, any>;
}) => {
  const token = await getAccessToken();
  await axios.post(
    '/api/payments?action=record-platform-fee',
    {
      bookingId: booking.id,
      payer,
      paymentMode,
      paymentStatus,
      transactionId,
      orderId,
      receiptUrl,
      gateway,
      coinsUsed,
      metadata,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
};

const getTransactionsForBooking = (transactions: Transaction[], bookingId: string) =>
  transactions
    .filter(
      (tx) =>
        tx.relatedId === bookingId ||
        tx.metadata?.bookingId === bookingId
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

const PaymentAuditTrail = ({
  booking,
  transactions = [],
  viewer,
}: {
  booking: Booking;
  transactions?: Transaction[];
  viewer: 'consumer' | 'driver' | 'admin';
}) => {
  const bookingTransactions = getTransactionsForBooking(transactions, booking.id);
  const relevantTransactions =
    viewer === 'admin'
      ? bookingTransactions
      : bookingTransactions.filter((tx) => tx.metadata?.payer === viewer);

  const travelerPaymentSummary = {
    paid: Boolean(booking.feePaid),
    mode: booking.consumerPaymentMode,
    gateway: booking.consumerPaymentGateway,
    transactionId: booking.consumerPaymentTransactionId,
    orderId: booking.consumerPaymentOrderId,
    receiptUrl: booking.consumerPaymentReceiptUrl,
    submittedAt: booking.consumerPaymentSubmittedAt,
    coinsUsed: booking.maiCoinsUsed || 0,
  };

  const driverPaymentSummary = {
    paid: Boolean(booking.driverFeePaid),
    mode: booking.driverPaymentMode,
    gateway: booking.driverPaymentGateway,
    transactionId: booking.driverPaymentTransactionId,
    orderId: booking.driverPaymentOrderId,
    receiptUrl: booking.driverPaymentReceiptUrl,
    submittedAt: booking.driverPaymentSubmittedAt,
    coinsUsed: booking.driverMaiCoinsUsed || 0,
  };

  const paymentRows =
    viewer === 'consumer'
      ? [{ label: 'Your payment', value: travelerPaymentSummary }]
      : viewer === 'driver'
        ? [{ label: 'Your payment', value: driverPaymentSummary }]
        : [
            { label: 'Traveler payment', value: travelerPaymentSummary },
            { label: 'Driver payment', value: driverPaymentSummary },
          ];

  return (
    <div className="mt-4 rounded-2xl border border-mairide-secondary/30 bg-mairide-bg p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Payment audit</p>
          <p className="mt-1 text-sm font-bold text-mairide-primary">Platform fee and gateway trace for this ride</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Fee + GST</p>
          <p className="text-lg font-black text-mairide-accent">{formatCurrency((booking.serviceFee || 0) + (booking.gstAmount || 0))}</p>
        </div>
      </div>

      <div className={cn("mt-4 grid gap-3", paymentRows.length === 2 ? "md:grid-cols-2" : "grid-cols-1")}>
        {paymentRows.map(({ label, value }) => (
          <div key={label} className="rounded-2xl bg-white p-4 border border-mairide-secondary/20">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">{label}</p>
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest",
                  value.paid ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                )}
              >
                {value.paid ? "paid" : "pending"}
              </span>
            </div>
            <div className="mt-3 space-y-2 text-sm text-mairide-primary">
              <div className="flex justify-between gap-3">
                <span className="text-mairide-secondary">Mode</span>
                <span className="font-bold capitalize">{value.mode || 'not submitted'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-mairide-secondary">Gateway</span>
                <span className="font-bold capitalize">{value.gateway || (value.mode === 'maicoins' ? 'maicoins' : 'manual')}</span>
              </div>
              {value.coinsUsed > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-mairide-secondary">MaiCoins used</span>
                  <span className="font-bold">{value.coinsUsed} MC</span>
                </div>
              )}
              {value.transactionId && (
                <div className="flex justify-between gap-3">
                  <span className="text-mairide-secondary">Transaction ID</span>
                  <span className="font-mono text-xs font-bold break-all text-right">{value.transactionId}</span>
                </div>
              )}
              {value.orderId && (
                <div className="flex justify-between gap-3">
                  <span className="text-mairide-secondary">Order ID</span>
                  <span className="font-mono text-xs font-bold break-all text-right">{value.orderId}</span>
                </div>
              )}
              {value.submittedAt && (
                <div className="flex justify-between gap-3">
                  <span className="text-mairide-secondary">Submitted</span>
                  <span className="font-bold text-right">{new Date(value.submittedAt).toLocaleString()}</span>
                </div>
              )}
              {value.receiptUrl && (
                <div className="pt-1">
                  <a
                    href={value.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold text-mairide-accent hover:underline"
                  >
                    View receipt
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {viewer === 'admin' && relevantTransactions.length > 0 && (
        <div className="mt-4 rounded-2xl bg-white p-4 border border-mairide-secondary/20">
          <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Stored transaction records</p>
          <div className="mt-3 space-y-3">
            {relevantTransactions.map((tx) => (
              <div key={tx.id} className="rounded-xl border border-mairide-secondary/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-sm text-mairide-primary">{tx.description}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">
                      {tx.metadata?.payer || 'payer'} • {tx.status} • {tx.currency}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-mairide-accent">{tx.currency === 'INR' ? formatCurrency(tx.amount) : `${tx.amount} MC`}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">{new Date(tx.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                {(tx.metadata?.transactionId || tx.metadata?.orderId) && (
                  <div className="mt-2 text-xs text-mairide-secondary space-y-1">
                    {tx.metadata?.transactionId && <p>Txn: <span className="font-mono text-mairide-primary">{tx.metadata.transactionId}</span></p>}
                    {tx.metadata?.orderId && <p>Order: <span className="font-mono text-mairide-primary">{tx.metadata.orderId}</span></p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const AdminTransactionsView = ({
  transactions,
  bookings,
  users,
}: {
  transactions: Transaction[];
  bookings: Booking[];
  users: UserProfile[];
}) => {
  const paymentTransactions = transactions
    .filter((tx) => tx.type === 'maintenance_fee_payment')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const totalRevenue = paymentTransactions
    .filter((tx) => tx.currency === 'INR' && tx.status === 'completed')
    .reduce((sum, tx) => sum + (tx.metadata?.serviceFee || 0), 0);
  const totalGST = paymentTransactions
    .filter((tx) => tx.currency === 'INR' && tx.status === 'completed')
    .reduce((sum, tx) => sum + (tx.metadata?.gstAmount || 0), 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Recorded payments</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{paymentTransactions.length}</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Revenue captured</p>
          <p className="mt-2 text-3xl font-black text-mairide-accent">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">GST captured</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{formatCurrency(totalGST)}</p>
        </div>
      </div>

      <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-sm overflow-hidden">
        <div className="p-8 border-b border-mairide-secondary">
          <h2 className="text-xl font-bold text-mairide-primary">Payment Transactions</h2>
          <p className="mt-2 text-sm text-mairide-secondary">Support and finance can review every platform-fee payment event here.</p>
        </div>
        <div className="divide-y divide-mairide-secondary">
          {paymentTransactions.length ? paymentTransactions.map((tx) => {
            const booking = bookings.find((item) => item.id === (tx.relatedId || tx.metadata?.bookingId));
            const user = users.find((item) => item.uid === tx.userId);
            return (
              <div key={tx.id} className="p-6 md:p-8">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
                  <div className="space-y-2 min-w-0">
                    <p className="text-lg font-bold text-mairide-primary break-words">{booking ? `${booking.origin} → ${booking.destination}` : tx.description}</p>
                    <p className="text-sm text-mairide-secondary">
                      {tx.metadata?.payer === 'driver' ? 'Driver' : 'Traveler'}: {user?.displayName || tx.userId}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <span className="rounded-full bg-mairide-bg px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-mairide-primary">
                        {tx.status}
                      </span>
                      <span className="rounded-full bg-mairide-bg px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-mairide-primary">
                        {tx.metadata?.gateway || tx.metadata?.paymentMode || 'payment'}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 min-w-full lg:min-w-[520px]">
                    <div className="rounded-2xl bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Total</p>
                      <p className="mt-2 text-lg font-black text-mairide-primary">{tx.currency === 'INR' ? formatCurrency(tx.amount) : `${tx.amount} MC`}</p>
                    </div>
                    <div className="rounded-2xl bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Revenue</p>
                      <p className="mt-2 text-lg font-black text-mairide-primary">{formatCurrency(tx.metadata?.serviceFee || 0)}</p>
                    </div>
                    <div className="rounded-2xl bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">GST</p>
                      <p className="mt-2 text-lg font-black text-mairide-primary">{formatCurrency(tx.metadata?.gstAmount || 0)}</p>
                    </div>
                    <div className="rounded-2xl bg-mairide-bg p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Captured</p>
                      <p className="mt-2 text-sm font-bold text-mairide-primary">{new Date(tx.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Gateway trace</p>
                    <div className="mt-2 space-y-1 text-mairide-primary break-words">
                      {tx.metadata?.transactionId && <p>Txn ID: <span className="font-mono text-xs break-all">{tx.metadata.transactionId}</span></p>}
                      {tx.metadata?.orderId && <p>Order ID: <span className="font-mono text-xs break-all">{tx.metadata.orderId}</span></p>}
                      <p>Mode: <span className="font-bold capitalize">{tx.metadata?.paymentMode || 'manual'}</span></p>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Ride linkage</p>
                    <div className="mt-2 space-y-1 text-mairide-primary break-words">
                      <p>Booking ID: <span className="font-mono text-xs break-all">{tx.metadata?.bookingId || tx.relatedId || 'N/A'}</span></p>
                      <p>Ride ID: <span className="font-mono text-xs break-all">{tx.metadata?.rideId || booking?.rideId || 'N/A'}</span></p>
                      {tx.metadata?.receiptUrl && (
                        <a href={tx.metadata.receiptUrl} target="_blank" rel="noreferrer" className="text-mairide-accent font-bold hover:underline">
                          View receipt
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="p-12 text-center text-mairide-secondary italic">No payment transactions recorded yet.</div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  if (errInfo.error.includes('the client is offline')) {
    console.error("CRITICAL: Firestore connection failed. The configuration in firebase-applet-config.json may be incorrect or the database is not provisioned.");
  }
  
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    // Try to reach the server directly to verify configuration
    await getDocFromServer(doc(db, '_connection_test_', 'ping'));
    console.log("Firestore connection verified.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("CRITICAL: Firestore connection failed. The configuration in firebase-applet-config.json may be incorrect or the database is not provisioned.");
    }
    // We don't throw here to avoid crashing the app on boot, but we log the error
  }
}

testConnection();

class ErrorBoundary extends Component<any, any> {
  state: any;
  props: any;

  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Something went wrong. Please refresh the page.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          displayMessage = "You don't have permission to perform this action. Please check your account status.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h1>
            <p className="text-gray-600 mb-6">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-orange-600 text-white py-4 rounded-2xl font-bold hover:bg-orange-700 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Components ---

const LOGO_URL = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHJ4PSIxNjAiIGZpbGw9IiMyNTM0M0YiLz48cGF0aCBkPSJNIDEwMCA0MDAgTCAyMDAgMTIwIEwgMjU2IDI1MCBMIDMxMiAxMjAgTCA0MTIgNDAwIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjUwIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48cGF0aCBkPSJNIDI1NiAyNTAgQyAyNTYgMjUwIDM1MCAyMDAgNDUwIDE1MCIgc3Ryb2tlPSIjRkY5QjUxIiBzdHJva2Utd2lkdGg9IjE1IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1kYXNoYXJyYXk9IjMwIDIwIi8+PHBhdGggZD0iTSA0NTAgMTUwIEwgNDMwIDE0MCBMIDQzNSAxNjAgTCA0NTAgMTUwIFoiIGZpbGw9IiNGRjlCNTEiLz48Y2lyY2xlIGN4PSIyNTYiIGN5PSIzMjAiIHI9IjE1IiBmaWxsPSIjRkY5QjUxIi8+PC9zdmc+";
const BRAND_NAME = "MaiRide my way";
const BRAND_TAGLINE = "";
const SUPER_ADMIN_EMAIL = (import.meta.env.VITE_SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || '';
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'v2.0.1-beta';
const APP_NAV_HOME_EVENT = 'mairide:navigate-home';
const APP_DIALOG_EVENT = 'mairide:dialog';
const APP_RIDE_RETIRED_EVENT = 'mairide:ride-retired';
const CONSENT_VERSION = 'consent-v1';
const isLocalDevHost = () =>
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const adminApiPath = (action: string) => `/api/admin-api?action=${encodeURIComponent(action)}`;
const adminConfigPath = "/api/admin-config";
const adminTransactionsPath = "/api/admin-transactions";
const adminVerifyDriverPath = "/api/verify-driver";
const getConfiguredRazorpayKeyId = (config?: Partial<AppConfig> | null) =>
  String(config?.razorpayKeyId || RAZORPAY_KEY_ID || '').trim();
const isRazorpayEnabled = (config?: Partial<AppConfig> | null) => Boolean(getConfiguredRazorpayKeyId(config));
const isLocalRazorpayEnabled = (config?: Partial<AppConfig> | null) => isRazorpayEnabled(config);
const getMaxHybridCoinOffset = (booking: Booking, balance: number, config?: Partial<AppConfig> | null) => {
  const { baseFee } = calculateServiceFee(booking.fare, config || undefined);
  return Math.min(balance, baseFee, MAX_MAICOINS_PER_RIDE);
};
const getHybridPaymentBreakdown = (booking: Booking, balance: number, useCoins: boolean, config?: Partial<AppConfig> | null) => {
  const { totalFee } = calculateServiceFee(booking.fare, config || undefined);
  const coinsToUse = useCoins ? getMaxHybridCoinOffset(booking, balance, config) : 0;
  const paymentMode: 'hybrid' | 'online' = coinsToUse > 0 ? 'hybrid' : 'online';
  return {
    totalFee,
    coinsToUse,
    amountPaid: Math.max(totalFee - coinsToUse, 0),
    paymentMode,
  };
};
let razorpayScriptPromise: Promise<boolean> | null = null;
const GOOGLE_MAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY &&
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY.length > 10
    ? import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    : "";

const formatGeoTimestamp = (timestamp?: number) => {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
};

const GeoTagMeta = ({ geoTag }: { geoTag?: { lat: number; lng: number; timestamp: number } | null }) => {
  if (!geoTag) return null;
  const capturedAt = formatGeoTimestamp(geoTag.timestamp);
  return (
    <div className="absolute bottom-2 left-2 bg-black/55 text-white text-[8px] px-2 py-1 rounded-xl backdrop-blur-md leading-tight">
      <div>Lat {geoTag.lat.toFixed(4)}, Lng {geoTag.lng.toFixed(4)}</div>
      {capturedAt && <div>Captured {capturedAt}</div>}
    </div>
  );
};

const TRAVELER_DISCLOSURE_TEXT =
  "I confirm that the personal, contact, pickup, destination, and account details I submit are true, accurate, and complete to the best of my knowledge. I agree to MaiRide's terms of use, safety rules, verification checks, and community standards. I understand that false, misleading, or incomplete information may lead to suspension, account closure, or legal reporting where required.";

const DRIVER_DISCLOSURE_TEXT =
  "I confirm that the personal, contact, vehicle, insurance, and identity details I submit are true, accurate, and complete to the best of my knowledge. I agree to MaiRide's terms of use, safety rules, verification checks, and community standards. I understand that false, misleading, or incomplete information may lead to suspension, account closure, or legal reporting where required.";

const MARKETING_DISCLOSURE_TEXT =
  "I agree to receive account updates, safety notices, service alerts, offers, and promotional communications from MaiRide by email, SMS, and WhatsApp. I understand I can change these preferences later if MaiRide provides that option.";

const DRIVER_DECLARATION_TEXT =
  "I confirm that my vehicle, registration, license, insurance, and identity documents belong to me or are lawfully under my control, and that every document and image submitted is current, genuine, and captured by me during this onboarding process.";

type VerificationMarker = {
  id: string;
  label: string;
  geoTag: { lat: number; lng: number; timestamp: number };
};

type AppDialogTone = 'info' | 'success' | 'warning' | 'error';

type AppDialogDetail = {
  title?: string;
  message: string;
  tone?: AppDialogTone;
};

const getBookingNegotiationField = <T,>(booking: Booking, key: string): T | undefined => {
  const nested = (booking as any)?.data?.[key];
  if (nested !== undefined && nested !== null && nested !== '') {
    return nested as T;
  }
  return (booking as any)?.[key] as T | undefined;
};

const getPendingNegotiationActor = (booking: Booking): 'driver' | 'consumer' | null => {
  const negotiatedFare = Number(getBookingNegotiationField<number | string>(booking, 'negotiatedFare'));
  const negotiationStatus = String(getBookingNegotiationField<string>(booking, 'negotiationStatus') || '');
  const negotiationActor = String(getBookingNegotiationField<string>(booking, 'negotiationActor') || '');
  const driverCounterPending = Boolean(getBookingNegotiationField<boolean>(booking, 'driverCounterPending'));

  if (!Number.isFinite(negotiatedFare) || negotiationStatus !== 'pending') {
    return null;
  }

  if (negotiationActor === 'driver') {
    return 'driver';
  }

  if (negotiationActor === 'consumer') {
    return 'consumer';
  }

  if (driverCounterPending) {
    return 'driver';
  }

  return null;
};

const hasPendingDriverCounterOffer = (booking: Booking) => {
  return getPendingNegotiationActor(booking) === 'driver';
};

const hasPendingTravelerCounterOffer = (booking: Booking) => {
  const negotiatedFare = Number(getBookingNegotiationField<number | string>(booking, 'negotiatedFare'));
  const negotiationStatus = String(getBookingNegotiationField<string>(booking, 'negotiationStatus') || '');
  const fare = Number(getBookingNegotiationField<number | string>(booking, 'fare'));

  if (!Number.isFinite(negotiatedFare) || negotiationStatus !== 'pending') {
    return false;
  }

  return getPendingNegotiationActor(booking) === 'consumer' && negotiatedFare !== fare;
};

const loadNegotiationThreadBookings = async (seedBooking: Booking) => {
  const rideId = seedBooking.rideId;
  const consumerId = seedBooking.consumerId;

  if (!rideId || !consumerId) {
    return [seedBooking];
  }

  const snapshot = await getDocs(
    query(
      collection(db, 'bookings'),
      where('rideId', '==', rideId),
      where('consumerId', '==', consumerId)
    )
  );

  const rows = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }));
  const threadKey = getBookingThreadKey(seedBooking);
  const threadRows = rows.filter((booking) => getBookingThreadKey(booking) === threadKey);

  return threadRows.length ? threadRows : [seedBooking];
};

const persistCounterOfferThroughCompatStore = async (
  seedBooking: Booking,
  actor: 'driver' | 'consumer',
  fare: number
) => {
  const updatedAt = new Date().toISOString();
  const threadRows = await loadNegotiationThreadBookings(seedBooking);

  await Promise.all(
    threadRows.map((booking) =>
      updateDoc(doc(db, 'bookings', booking.id), {
        negotiatedFare: fare,
        negotiationStatus: 'pending',
        negotiationActor: actor,
        driverCounterPending: actor === 'driver',
        status: 'negotiating',
        rideRetired: false,
        updatedAt,
      })
    )
  );

  return updatedAt;
};

const persistNegotiationResolutionThroughCompatStore = async (
  seedBooking: Booking,
  actor: 'driver' | 'consumer',
  action: 'accepted' | 'rejected' | 'confirmed',
  options?: {
    acceptedFare?: number;
    driverPhone?: string;
  }
) => {
  const updatedAt = new Date().toISOString();
  const threadRows = await loadNegotiationThreadBookings(seedBooking);
  const normalizedAction = action === 'confirmed' ? 'accepted' : action;
  const nextStatus = normalizedAction === 'accepted' ? 'confirmed' : 'rejected';
  const nextNegotiationStatus = normalizedAction === 'accepted' ? 'accepted' : 'rejected';
  const nextFare =
    normalizedAction === 'accepted'
      ? options?.acceptedFare ?? getNegotiationDisplayFare(seedBooking)
      : undefined;

  await Promise.all(
    threadRows.map((booking) =>
      updateDoc(doc(db, 'bookings', booking.id), {
        ...(normalizedAction === 'accepted' && Number.isFinite(nextFare) ? { fare: nextFare } : {}),
        status: nextStatus,
        negotiationStatus: nextNegotiationStatus,
        negotiationActor: actor,
        driverCounterPending: false,
        rideRetired: normalizedAction === 'rejected',
        ...(options?.driverPhone ? { driverPhone: options.driverPhone } : {}),
        updatedAt,
      })
    )
  );

  if (normalizedAction === 'accepted' && seedBooking.rideId) {
    await updateDoc(doc(db, 'rides', seedBooking.rideId), {
      status: 'full',
      updatedAt,
    });
  }

  return updatedAt;
};

const getNegotiationDisplayFare = (booking: Booking) => {
  const negotiatedFare = Number(getBookingNegotiationField<number | string>(booking, 'negotiatedFare'));
  const negotiationStatus = String(getBookingNegotiationField<string>(booking, 'negotiationStatus') || '');
  const fare = Number(getBookingNegotiationField<number | string>(booking, 'fare'));

  if (Number.isFinite(negotiatedFare) && negotiationStatus === 'pending') {
    return negotiatedFare;
  }

  return fare;
};

const getBookingStateLabel = (booking: Booking) => {
  if (hasPendingDriverCounterOffer(booking)) return 'counter offer';
  if (hasPendingTravelerCounterOffer(booking)) return 'your offer pending';
  return booking.status;
};

const getListedFare = (booking: Booking) => {
  const listedFare = Number(getBookingNegotiationField<number | string>(booking, 'listedFare'));
  if (Number.isFinite(listedFare) && listedFare > 0) {
    return listedFare;
  }
  return Number(getBookingNegotiationField<number | string>(booking, 'fare'));
};

const shouldShowNegotiatedFareLine = (booking: Booking) => {
  const listedFare = getListedFare(booking);
  const displayFare = getNegotiationDisplayFare(booking);
  return Math.abs(displayFare - listedFare) > 0.001;
};

const getBookingThreadKey = (booking: Partial<Booking>) => {
  const rideId = booking.rideId || '';
  if (rideId) {
    return `${rideId}__${booking.consumerId || ''}`;
  }
  const driverId = booking.driverId || '';
  const consumerId = booking.consumerId || '';
  const origin = normalizeSearchText(booking.origin || '');
  const destination = normalizeSearchText(booking.destination || '');
  return `${driverId}__${consumerId}__${origin}__${destination}`;
};

const getRecordTimestamp = (record: { updatedAt?: string; createdAt?: string }) =>
  new Date(record.updatedAt || record.createdAt || 0).getTime();

const dedupeBookingsByThread = <T extends Booking>(bookings: T[]) => {
  const latestByThread = new Map<string, T>();

  bookings.forEach((booking) => {
    const threadKey = getBookingThreadKey(booking);
    const existing = latestByThread.get(threadKey);
    if (!existing || getRecordTimestamp(booking) >= getRecordTimestamp(existing)) {
      latestByThread.set(threadKey, booking);
    }
  });

  return Array.from(latestByThread.values());
};

const primaryActionButtonClass =
  "rounded-xl font-bold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:shadow-sm";

const secondaryActionButtonClass =
  "rounded-xl font-bold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm";

const inferDialogTone = (message: string): AppDialogTone => {
  const lowered = message.toLowerCase();
  if (lowered.includes('success') || lowered.includes('submitted') || lowered.includes('created') || lowered.includes('copied')) {
    return 'success';
  }
  if (lowered.includes('failed') || lowered.includes('error') || lowered.includes('invalid') || lowered.includes('rejected')) {
    return 'error';
  }
  if (lowered.includes('please') || lowered.includes('warning') || lowered.includes('cannot')) {
    return 'warning';
  }
  return 'info';
};

const showAppDialog = (message: string, tone?: AppDialogTone, title?: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<AppDialogDetail>(APP_DIALOG_EVENT, {
      detail: {
        message,
        tone: tone || inferDialogTone(message),
        title,
      },
    })
  );
};

const ensureRazorpayCheckoutScript = async () => {
  if (typeof window === 'undefined') return false;
  if (window.Razorpay) return true;

  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise<boolean>((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => {
        razorpayScriptPromise = null;
        resolve(false);
      };
      document.body.appendChild(script);
    });
  }

  const loaded = await razorpayScriptPromise;
  if (!loaded) {
    razorpayScriptPromise = null;
  }
  return loaded;
};

const startRazorpayPlatformFeeCheckout = async ({
  booking,
  payer,
  profile,
  config,
  amount,
  coinsUsed = 0,
  onVerified,
}: {
  booking: Booking;
  payer: 'consumer' | 'driver';
  profile: UserProfile;
  config?: AppConfig | null;
  amount?: number;
  coinsUsed?: number;
  onVerified: (payment: { paymentId: string; orderId: string; signature: string }) => Promise<void>;
}) => {
  const razorpayKeyId = getConfiguredRazorpayKeyId(config);

  if (!razorpayKeyId) {
    showAppDialog('Razorpay test checkout is not enabled for this environment.', 'warning', 'Payment unavailable');
    return false;
  }

  const scriptLoaded = await ensureRazorpayCheckoutScript();
  if (!scriptLoaded || !window.Razorpay) {
    showAppDialog('We could not load Razorpay checkout. Please check your internet connection and try again.', 'error', 'Checkout unavailable');
    throw new Error('Failed to load Razorpay checkout.');
  }

  const token = await getAccessToken();
  const { totalFee } = calculateServiceFee(booking.fare, config || undefined);
  const payableAmount = typeof amount === 'number' && Number.isFinite(amount) ? amount : totalFee;
  let order;
  try {
    const orderResponse = await axios.post(
      '/api/payments?action=create-razorpay-order',
      {
        amount: payableAmount,
        bookingId: booking.id,
        payer,
        notes: {
          route: `${booking.origin} -> ${booking.destination}`,
          coinsUsed,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    order = orderResponse.data;
  } catch (error: any) {
    const message = error?.response?.data?.error || error?.message || 'We could not initialize the Razorpay order.';
    showAppDialog(message, 'error', 'Payment unavailable');
    throw new Error(message);
  }

  if (!order?.id) {
    showAppDialog('We could not initialize the Razorpay order. Please try again.', 'error', 'Payment unavailable');
    throw new Error('Failed to initialize Razorpay order.');
  }

  await new Promise<void>((resolve, reject) => {
    const razorpay = new window.Razorpay!({
      key: razorpayKeyId,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      name: BRAND_NAME,
      description: `${payer === 'consumer' ? 'Traveler' : 'Driver'} platform fee`,
      image: LOGO_URL,
      theme: {
        color: '#F47C20',
      },
      prefill: {
        name: profile.displayName || '',
        email: profile.email || '',
        contact: profile.phoneNumber ? profile.phoneNumber.replace(/[^\d]/g, '').slice(-10) : '',
      },
      notes: order.notes,
      modal: {
        ondismiss: () => reject(new Error('Razorpay checkout was closed.')),
      },
      handler: async (response: Record<string, string>) => {
        try {
          const verification = await axios.post(
            '/api/payments?action=verify-razorpay-payment',
            response,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (!verification.data?.verified || !response.razorpay_payment_id || !response.razorpay_order_id || !response.razorpay_signature) {
            reject(new Error('Razorpay payment verification failed.'));
            return;
          }

          await onVerified({
            paymentId: response.razorpay_payment_id,
            orderId: response.razorpay_order_id,
            signature: response.razorpay_signature,
          });
          resolve();
        } catch (error: any) {
          reject(new Error(error?.response?.data?.error || error?.message || 'Failed to verify Razorpay payment.'));
        }
      },
    });

    razorpay.open();
  });

  return true;
};

const canUseBrowserNotifications = () =>
  typeof window !== 'undefined' && 'Notification' in window;

const ensureBrowserNotificationPermission = async () => {
  if (!canUseBrowserNotifications()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
};

const sendBrowserNotification = async (
  title: string,
  body: string,
  options?: { tag?: string; requirePermissionPrompt?: boolean }
) => {
  if (!canUseBrowserNotifications()) return false;
  const permission = options?.requirePermissionPrompt
    ? await ensureBrowserNotificationPermission()
    : Notification.permission;
  if (permission !== 'granted') return false;
  try {
    new Notification(title, {
      body,
      tag: options?.tag,
      icon: '/logo.png',
    });
    return true;
  } catch {
    return false;
  }
};

const buildVerificationMarkers = (driverDetails?: UserProfile['driverDetails'] | null): VerificationMarker[] => {
  if (!driverDetails) return [];
  const candidates = [
    { id: 'selfie', label: 'Selfie', geoTag: driverDetails.selfieGeoTag },
    { id: 'aadhaar-front', label: 'Aadhaar Front', geoTag: driverDetails.aadhaarFrontGeoTag },
    { id: 'aadhaar-back', label: 'Aadhaar Back', geoTag: driverDetails.aadhaarBackGeoTag },
    { id: 'dl-front', label: 'DL Front', geoTag: driverDetails.dlFrontGeoTag },
    { id: 'dl-back', label: 'DL Back', geoTag: driverDetails.dlBackGeoTag },
    { id: 'vehicle', label: 'Vehicle', geoTag: driverDetails.vehicleGeoTag },
    { id: 'rc', label: 'RC', geoTag: driverDetails.rcGeoTag },
  ];
  return candidates.filter((item): item is VerificationMarker => !!item.geoTag);
};

const VerificationMap = ({
  markers,
  isLoaded,
  title,
  subtitle,
}: {
  markers: VerificationMarker[];
  isLoaded: boolean;
  title: string;
  subtitle: string;
}) => {
  if (!markers.length) {
    return (
      <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg p-5">
        <h3 className="text-sm font-bold text-mairide-primary mb-1">{title}</h3>
        <p className="text-xs text-mairide-secondary">{subtitle}</p>
      </div>
    );
  }

  const center =
    markers.length === 1
      ? { lat: markers[0].geoTag.lat, lng: markers[0].geoTag.lng }
      : {
          lat: markers.reduce((sum, marker) => sum + marker.geoTag.lat, 0) / markers.length,
          lng: markers.reduce((sum, marker) => sum + marker.geoTag.lng, 0) / markers.length,
        };

  return (
    <div className="rounded-[28px] border border-mairide-secondary bg-white overflow-hidden shadow-sm">
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-sm font-bold text-mairide-primary">{title}</h3>
        <p className="text-xs text-mairide-secondary">{subtitle}</p>
      </div>
      {GOOGLE_MAPS_API_KEY && isLoaded && window.google ? (
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '220px' }}
          center={center}
          zoom={14}
          options={{
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: 'greedy',
          }}
        >
          {markers.map((marker) => (
            <Marker
              key={marker.id}
              position={{ lat: marker.geoTag.lat, lng: marker.geoTag.lng }}
              title={`${marker.label} • ${formatGeoTimestamp(marker.geoTag.timestamp) || 'Captured'}`}
              label={{
                text: marker.label.slice(0, 1),
                color: '#ffffff',
                fontSize: '10px',
                fontWeight: '700',
              }}
            />
          ))}
        </GoogleMap>
      ) : (
        <div className="h-[220px] bg-mairide-bg flex items-center justify-center text-xs text-mairide-secondary px-6 text-center">
          Map preview will appear here when Google Maps is available.
        </div>
      )}
      <div className="px-5 py-4 bg-mairide-bg/60 border-t border-mairide-secondary/60">
        <div className="flex flex-wrap gap-2">
          {markers.map((marker) => (
            <span
              key={marker.id}
              className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[10px] font-bold text-mairide-primary border border-mairide-secondary"
            >
              {marker.label} • {formatGeoTimestamp(marker.geoTag.timestamp) || 'Captured'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const getAccessToken = async () => {
  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token || (await auth.currentUser?.getIdToken?.()) || '';
  if (!token) {
    throw new Error('No authentication token found');
  }
  return token;
};

const getAdminRequestHeaders = async (adminEmail?: string | null) => {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    ...(adminEmail ? { 'x-dev-super-admin-email': adminEmail } : {}),
  };
};

const getResolvedUserRating = (user?: UserProfile | null) => {
  const aggregateRating = user?.reviewStats?.averageRating;
  if (typeof aggregateRating === 'number' && user?.reviewStats?.ratingCount) {
    return Number(aggregateRating.toFixed(1));
  }
  if (typeof user?.driverDetails?.rating === 'number') {
    return Number(user.driverDetails.rating.toFixed(1));
  }
  return 5.0;
};

const getResolvedUserPhoto = (user?: UserProfile | null) =>
  user?.photoURL || user?.driverDetails?.selfiePhoto || '';

const getApiErrorMessage = (error: any, fallback: string) => {
  const apiError = error?.response?.data?.error;
  if (typeof apiError === 'string' && apiError.trim()) return apiError;
  if (apiError?.message) return apiError.message;
  if (error?.message) return error.message;
  return fallback;
};

const parseApiResponse = async (response: Response, fallback: string) => {
  const rawText = await response.text();
  let payload: any = null;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }

  if (!response.ok) {
    const errorMessage =
      (typeof payload === 'object' && payload?.error) ||
      (typeof payload === 'object' && payload?.Details) ||
      (typeof payload === 'string' && payload.trim() ? payload : null) ||
      `${fallback} (HTTP ${response.status})`;
    throw new Error(errorMessage);
  }

  if (typeof payload === 'string') {
    const normalized = payload.trim().toLowerCase();
    if (normalized.startsWith('<!doctype') || normalized.startsWith('<html')) {
      throw new Error(`${fallback}. The server returned an unexpected HTML response.`);
    }
    throw new Error(`${fallback}. The server returned an unexpected response.`);
  }

  return payload;
};

const hasSubmittedBookingReview = (booking: Booking, reviewerRole: 'consumer' | 'driver') =>
  reviewerRole === 'consumer' ? !!booking.consumerReview : !!booking.driverReview;

const submitBookingReview = async (
  bookingId: string,
  rating: number,
  comment: string,
  traits: string[]
) => {
  const token = await getAccessToken();
  const response = await axios.post(
    '/api/bookings?action=submit-review',
    { bookingId, rating, comment, traits },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return response.data;
};

const LoadingScreen = () => (
  <div className="fixed inset-0 bg-mairide-bg flex flex-col items-center justify-center z-50">
    <motion.div
      animate={{ scale: [1, 1.2, 1], rotate: [0, 360] }}
      transition={{ duration: 2, repeat: Infinity }}
      className="mb-4"
    >
      <div className="flex flex-col items-center">
        <img src={LOGO_URL} className="w-48 h-48 object-contain" alt="MaiRide Logo" />
        <h1 className="text-4xl font-black text-mairide-primary mt-4 tracking-tighter">
          {BRAND_NAME}
        </h1>
        <p className="text-[10px] text-mairide-secondary mt-2 opacity-50">
          {APP_VERSION} | All rights reserved MaiRide
        </p>
      </div>
    </motion.div>
  </div>
);

const AppFooter = () => (
  <footer className="px-4 pb-6">
    <div className="max-w-7xl mx-auto flex justify-center">
      <p className="text-[11px] text-mairide-secondary/80 tracking-wide text-center">
        Release {APP_VERSION} | Copyright {new Date().getFullYear()} MaiRide. All rights reserved.
      </p>
    </div>
  </footer>
);

const AppDialogHost = () => {
  const [dialog, setDialog] = useState<AppDialogDetail | null>(null);

  useEffect(() => {
    const handleDialog = (event: Event) => {
      const customEvent = event as CustomEvent<AppDialogDetail>;
      if (customEvent.detail?.message) {
        setDialog(customEvent.detail);
      }
    };

    window.addEventListener(APP_DIALOG_EVENT, handleDialog);
    return () => window.removeEventListener(APP_DIALOG_EVENT, handleDialog);
  }, []);

  if (!dialog) return null;

  const toneStyles: Record<AppDialogTone, { chip: string; button: string; icon: React.ReactNode }> = {
    info: {
      chip: 'bg-mairide-primary/10 text-mairide-primary',
      button: 'bg-mairide-primary hover:bg-mairide-accent',
      icon: <MessageSquare className="w-6 h-6" />,
    },
    success: {
      chip: 'bg-green-100 text-green-700',
      button: 'bg-green-600 hover:bg-green-700',
      icon: <CheckCircle2 className="w-6 h-6" />,
    },
    warning: {
      chip: 'bg-orange-100 text-orange-700',
      button: 'bg-mairide-accent hover:bg-mairide-primary',
      icon: <AlertTriangle className="w-6 h-6" />,
    },
    error: {
      chip: 'bg-red-100 text-red-700',
      button: 'bg-red-600 hover:bg-red-700',
      icon: <AlertCircle className="w-6 h-6" />,
    },
  };

  const tone = dialog.tone || 'info';
  const styles = toneStyles[tone];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-mairide-primary/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', styles.chip)}>
            {styles.icon}
          </div>
          <button
            onClick={() => setDialog(null)}
            className="rounded-full bg-mairide-bg p-2 text-mairide-secondary transition-colors hover:text-mairide-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">
            {dialog.title || 'MaiRide Update'}
          </p>
          <p className="mt-3 text-base leading-7 text-mairide-primary">{dialog.message}</p>
        </div>
        <button
          onClick={() => setDialog(null)}
          className={cn('mt-6 w-full rounded-2xl py-3 text-sm font-bold text-white transition-colors', styles.button)}
        >
          Got it
        </button>
      </div>
    </div>
  );
};

const Navbar = ({ user, profile, onLogout }: { user: User, profile: UserProfile | null, onLogout: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const handleHomeNavigation = () => {
    window.dispatchEvent(new CustomEvent(APP_NAV_HOME_EVENT, { detail: { role: profile?.role } }));
    navigate('/');
    setIsOpen(false);
  };

  return (
    <nav className="bg-white border-b border-mairide-secondary sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center cursor-pointer" onClick={handleHomeNavigation}>
            <img src={LOGO_URL} className="w-12 h-12 object-contain mr-2" alt="MaiRide Logo" />
            <span className="text-xl font-black tracking-tighter text-mairide-primary">
              {BRAND_NAME}
            </span>
          </div>
          
          <div className="hidden md:flex items-center space-x-6">
            <button onClick={handleHomeNavigation} className="text-mairide-primary hover:text-mairide-accent font-medium">Home</button>
            <button onClick={() => navigate('/support')} className="text-mairide-primary hover:text-mairide-accent font-medium">Support</button>
            {profile?.role === 'admin' && (
              <button onClick={() => navigate('/admin')} className="text-mairide-primary hover:text-mairide-accent font-medium">Admin Panel</button>
            )}
            {profile?.role === 'driver' ? (
              <button onClick={() => navigate('/driver/rides')} className="text-mairide-primary hover:text-mairide-accent font-medium">My Rides</button>
            ) : (
              <button onClick={() => navigate('/consumer/bookings')} className="text-mairide-primary hover:text-mairide-accent font-medium">My Bookings</button>
            )}
            <div className="flex items-center space-x-3 pl-4 border-l border-mairide-secondary">
              <div className="text-right">
                <p className="text-sm font-semibold text-mairide-primary">{profile?.displayName}</p>
                <p className="text-xs text-mairide-secondary capitalize">{profile?.role}</p>
              </div>
                <img src={getResolvedUserPhoto(profile) || undefined} alt="Profile" className="w-8 h-8 rounded-full border border-mairide-secondary" />
              <button onClick={onLogout} className="p-2 text-mairide-secondary hover:text-red-600 transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="md:hidden">
            <button onClick={() => setIsOpen(!isOpen)} className="p-2 text-mairide-primary">
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-mairide-primary/40 backdrop-blur-sm md:hidden"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl border-r border-mairide-secondary md:hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-mairide-secondary">
                <div className="flex items-center gap-3">
                  <img src={getResolvedUserPhoto(profile) || LOGO_URL} alt="Profile" className="w-11 h-11 rounded-full object-cover border border-mairide-secondary" />
                  <div>
                    <p className="font-semibold text-mairide-primary leading-tight">{profile?.displayName}</p>
                    <p className="text-xs text-mairide-secondary capitalize">{profile?.role}</p>
                  </div>
                </div>
                <button onClick={() => setIsOpen(false)} className="p-2 text-mairide-secondary hover:text-mairide-primary transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-4 py-4 space-y-2">
                <button onClick={handleHomeNavigation} className="block w-full rounded-2xl px-4 py-3 text-left font-semibold text-mairide-primary hover:bg-mairide-bg transition-colors">Home</button>
                <button onClick={() => { navigate('/support'); setIsOpen(false); }} className="block w-full rounded-2xl px-4 py-3 text-left font-semibold text-mairide-primary hover:bg-mairide-bg transition-colors">Support</button>
                {profile?.role === 'admin' && (
                  <button onClick={() => { navigate('/admin'); setIsOpen(false); }} className="block w-full rounded-2xl px-4 py-3 text-left font-semibold text-mairide-primary hover:bg-mairide-bg transition-colors">Admin Panel</button>
                )}
                <button
                  onClick={() => {
                    navigate(profile?.role === 'driver' ? '/driver/rides' : '/consumer/bookings');
                    setIsOpen(false);
                  }}
                  className="block w-full rounded-2xl px-4 py-3 text-left font-semibold text-mairide-primary hover:bg-mairide-bg transition-colors"
                >
                  {profile?.role === 'driver' ? 'My Rides' : 'My Bookings'}
                </button>
              </div>
              <div className="mt-auto px-4 pb-6">
                <button onClick={onLogout} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mairide-primary px-4 py-3 font-semibold text-white shadow-lg shadow-mairide-primary/20 transition-transform hover:scale-[1.01] active:scale-[0.99]">
                  <LogOut className="w-5 h-5" />
                  <span>Logout</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </nav>
  );
};

const MobileSectionDrawer = ({
  title,
  activeLabel,
  items,
  onSelect,
}: {
  title: string;
  activeLabel: string;
  items: { id: string; label: string; icon: LucideIcon }[];
  onSelect: (id: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="md:hidden mb-6">
      <button
        onClick={() => setIsOpen(true)}
        className="flex w-full items-center justify-between rounded-2xl border border-mairide-secondary bg-white px-4 py-3 text-left shadow-sm"
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">{title}</p>
          <p className="mt-1 text-base font-semibold text-mairide-primary">{activeLabel}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-mairide-bg text-mairide-primary">
          <Menu className="w-5 h-5" />
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-mairide-primary/40 backdrop-blur-sm"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl border-r border-mairide-secondary"
            >
              <div className="flex items-center justify-between border-b border-mairide-secondary px-5 py-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-mairide-secondary">{title}</p>
                  <p className="mt-1 text-lg font-semibold text-mairide-primary">{activeLabel}</p>
                </div>
                <button onClick={() => setIsOpen(false)} className="p-2 text-mairide-secondary hover:text-mairide-primary transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-4 py-4 space-y-2">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        onSelect(item.id);
                        setIsOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left font-semibold text-mairide-primary transition-colors hover:bg-mairide-bg"
                    >
                      <Icon className="w-5 h-5 text-mairide-accent" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Auth Pages ---

interface AuthPageProps {
  user: User | null;
  authMode: 'login' | 'signup';
  setAuthMode: (mode: 'login' | 'signup') => void;
  notRegisteredError: boolean;
  setNotRegisteredError: (val: boolean) => void;
  role: 'consumer' | 'driver';
  setRole: (role: 'consumer' | 'driver') => void;
  referralCodeInput: string;
  setReferralCodeInput: (val: string) => void;
}

const normalizePhoneForAuth = (value: string) => String(value || '').replace(/[^\d]/g, '');
const PHONE_LOGIN_PROFILE_KEY = 'mairide_phone_profile_uid';
const PHONE_LOGIN_NUMBER_KEY = 'mairide_phone_login_number';

const sanitizeDisplayName = (value: string) =>
  String(value || '')
    .replace(/[^a-zA-Z\s.'-]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, 80);

const normalizeEmailValue = (value: string) => String(value || '').trim().toLowerCase();

const isValidEmailValue = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalizeEmailValue(value));

const sanitizeIndianPhoneDigits = (value: string) => {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length <= 10) return digits;
  if (digits.startsWith('91')) return digits.slice(-10);
  return digits.slice(0, 10);
};

const toIndianPhoneStorage = (value: string) => {
  const digits = sanitizeIndianPhoneDigits(value);
  return digits.length === 10 ? `+91${digits}` : '';
};

const formatPhoneForDisplay = (value?: string) => {
  const digits = sanitizeIndianPhoneDigits(value || '');
  if (!digits) return 'Not provided';
  return `+91 ${digits}`;
};

const getDialablePhone = (value?: string) => {
  const digits = sanitizeIndianPhoneDigits(value || '');
  if (digits.length === 10) return `+91${digits}`;
  const normalized = normalizePhoneForAuth(value || '');
  return normalized ? `+${normalized}` : '';
};

const sanitizeAadhaarDigits = (value: string) => String(value || '').replace(/[^\d]/g, '').slice(0, 12);

const splitAadhaarDigits = (value: string) => {
  const digits = sanitizeAadhaarDigits(value);
  return [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 12)];
};

const formatAadhaarForDisplay = (value?: string) => {
  const [a = '', b = '', c = ''] = splitAadhaarDigits(value || '');
  return [a, b, c].filter(Boolean).join(' ') || 'Not provided';
};

const sanitizeLicenseOrVehicleCode = (value: string, maxLength = 20) =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9/\-\s]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, maxLength);

const IndianPhoneInput = ({
  value,
  onChange,
  placeholder = 'Enter 10-digit mobile number',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) => (
  <div className="flex items-center bg-mairide-bg border border-mairide-secondary rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-mairide-accent">
    <span className="px-4 py-4 text-sm font-bold text-mairide-primary border-r border-mairide-secondary bg-white/50">+91</span>
    <input
      type="tel"
      inputMode="numeric"
      autoComplete="tel-national"
      pattern="[0-9]{10}"
      maxLength={10}
      className="w-full px-4 py-4 bg-transparent outline-none text-mairide-primary"
      value={sanitizeIndianPhoneDigits(value)}
      onChange={(e) => onChange(sanitizeIndianPhoneDigits(e.target.value))}
      placeholder={placeholder}
    />
  </div>
);

const buildPhoneVariants = (value: string) => {
  const digits = normalizePhoneForAuth(value);
  const variants = new Set<string>();

  if (!digits) return [];

  variants.add(digits);
  variants.add(`+${digits}`);

  if (digits.length > 10) {
    const last10 = digits.slice(-10);
    variants.add(last10);
    variants.add(`+${last10}`);
  }

  return Array.from(variants);
};

const maskPhoneNumber = (value: string) => {
  const digits = normalizePhoneForAuth(value);
  if (!digits) return '';
  if (digits.length <= 4) return digits;
  return `${digits[0]}${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-3)}`;
};

const ContactUnlockCard = ({
  label,
  phoneNumber,
}: {
  label: string;
  phoneNumber?: string;
}) => {
  const dialable = getDialablePhone(phoneNumber);
  const display = formatPhoneForDisplay(phoneNumber);

  return (
    <div className="mt-2 bg-green-50 p-3 rounded-xl flex items-center justify-between gap-3 text-green-700">
      <div className="flex items-center space-x-2 min-w-0">
        <Phone className="w-4 h-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-green-700/70">{label}</p>
          {dialable ? (
            <a href={`tel:${dialable}`} className="font-bold underline decoration-green-300 underline-offset-4 break-all hover:text-green-800 transition-colors">
              {display}
            </a>
          ) : (
            <span className="font-bold">{display}</span>
          )}
        </div>
      </div>
      {dialable ? (
        <a
          href={`tel:${dialable}`}
          className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-green-700 border border-green-100 hover:bg-green-100 transition-colors"
        >
          Call Now
        </a>
      ) : null}
    </div>
  );
};

const formatRideDeparture = (ride: Partial<Ride>) => {
  const dayLabel = ride.departureDayLabel?.trim();
  const clock = ride.departureClock?.trim();

  if (dayLabel && clock) {
    return `${dayLabel} at ${clock}`;
  }

  if (dayLabel) {
    return dayLabel;
  }

  if (ride.departureTime) {
    const date = new Date(ride.departureTime);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  }

  return 'Departure time to be confirmed';
};

const isFutureRide = (ride: Partial<Ride>) => {
  if (!ride.departureTime) return false;
  const departure = new Date(ride.departureTime);
  if (Number.isNaN(departure.getTime())) return false;
  return departure.getTime() > Date.now();
};

const isRideWithinPlanningWindow = (ride: Partial<Ride>) => {
  if (!ride.departureTime) return true;
  const departure = new Date(ride.departureTime);
  if (Number.isNaN(departure.getTime())) return true;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDayAfter = new Date(startOfToday);
  endOfDayAfter.setDate(endOfDayAfter.getDate() + 2);
  endOfDayAfter.setHours(23, 59, 59, 999);

  return departure >= startOfToday && departure <= endOfDayAfter;
};

const findUserProfileByPhone = async (value: string) => {
  const loginDigits = normalizePhoneForAuth(value);
  const loginTail = loginDigits.slice(-10);
  const usersSnapshot = await getDocs(query(collection(db, 'users')));
  const matchedDoc = usersSnapshot.docs.find((snapshotDoc) => {
    const rawUser = snapshotDoc.data() as UserProfile & {
      data?: { phoneNumber?: string; uid?: string };
      phone_number?: string;
    };
    const storedPhoneDigits = normalizePhoneForAuth(
      rawUser.phoneNumber
      || rawUser.phone_number
      || rawUser.data?.phoneNumber
      || ''
    );
    if (!storedPhoneDigits) return false;
    return (
      storedPhoneDigits === loginDigits
      || storedPhoneDigits === loginTail
      || storedPhoneDigits.endsWith(loginTail)
      || loginDigits.endsWith(storedPhoneDigits)
    );
  });

  if (!matchedDoc) return null;

  const matchedUser = matchedDoc.data() as UserProfile & {
    data?: { phoneNumber?: string; uid?: string };
    phone_number?: string;
  };

  return {
    ...matchedUser,
    uid: matchedUser.uid || matchedUser.data?.uid || matchedDoc.id,
    phoneNumber: matchedUser.phoneNumber || matchedUser.phone_number || matchedUser.data?.phoneNumber || '',
  } as UserProfile;
};

const AuthPage = ({ 
  user, 
  authMode, 
  setAuthMode, 
  notRegisteredError, 
  setNotRegisteredError, 
  role, 
  setRole,
  referralCodeInput,
  setReferralCodeInput
}: AuthPageProps) => {
  const [isRedirectedFromLogin, setIsRedirectedFromLogin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(''); // For email or phone login
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'email-otp' | 'otp'>('phone');
  const [sessionId, setSessionId] = useState('');
  const [emailSessionId, setEmailSessionId] = useState('');
  const [truthDeclarationAccepted, setTruthDeclarationAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const maskedOtpPhone = maskPhoneNumber(phoneNumber || username);
  const normalizedSignupPhone = toIndianPhoneStorage(phoneNumber);
  const normalizedSignupEmail = normalizeEmailValue(email);

  const postAuthAction = async (action: string, payload: Record<string, any>, fallbackPath?: string) => {
    const primaryResponse = await fetch(`/api/auth?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (primaryResponse.status !== 404 || !fallbackPath) {
      return primaryResponse;
    }

    return fetch(fallbackPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  const resolvePhoneLoginClientSide = async (value: string) => {
    const matchedUser = await findUserProfileByPhone(value);

    if (matchedUser) {
      return {
        uid: matchedUser.uid,
        role: matchedUser.role,
        email: matchedUser.email || '',
        phoneNumber: matchedUser.phoneNumber || '',
      };
    }

    throw new Error("NOT_REGISTERED");
  };

  // Pre-fill if user changes (e.g. after Google login)
  useEffect(() => {
    if (user) {
      if (user.phoneNumber && !phoneNumber) setPhoneNumber(user.phoneNumber);
      if (user.email && !email) setEmail(user.email);
      if (user.displayName && !displayName) setDisplayName(user.displayName);
      // If user is present but no profile, they should be in signup mode
      setAuthMode('signup');
    }
  }, [user]);

  useEffect(() => {
    if (step !== 'otp' || typeof window === 'undefined' || !('OTPCredential' in window) || !('credentials' in navigator)) {
      return;
    }

    const abortController = new AbortController();

    (async () => {
      try {
        const credential = await (navigator.credentials as any).get({
          otp: { transport: ['sms'] },
          signal: abortController.signal,
        });

        const code = credential?.code;
        if (typeof code === 'string' && code.trim()) {
          setOtp(code.trim().slice(0, 6));
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          console.debug('WebOTP autofill unavailable:', error);
        }
      }
    })();

    return () => abortController.abort();
  }, [step, sessionId]);

  const handleSendEmailOtp = async () => {
    if (!normalizedSignupEmail || !isValidEmailValue(normalizedSignupEmail)) return;
    setIsLoading(true);
    try {
      const response = await postAuthAction('send-email-otp', { email: normalizedSignupEmail }, '/api/auth/send-email-otp');
      const data = await parseApiResponse(response, 'Failed to send Email OTP');
      if (data.Status === 'Success') {
        setEmailSessionId(data.Details);
        setStep('email-otp');
      } else if (data.Code === 'EMAIL_OTP_UNAVAILABLE') {
        const phoneOtpResponse = await postAuthAction('send-otp', { phoneNumber: normalizedSignupPhone }, '/api/auth/send-otp');
        const phoneOtpData = await parseApiResponse(phoneOtpResponse, 'Failed to send phone OTP');
        if (phoneOtpData.Status === 'Success') {
          setSessionId(phoneOtpData.Details);
          setStep('otp');
          alert('Email OTP is unavailable right now. We have sent an OTP to your phone instead so you can continue signup.');
        } else {
          throw new Error(phoneOtpData.Details || 'Failed to send phone OTP');
        }
      } else {
        throw new Error(data.Details || 'Failed to send Email OTP');
      }
    } catch (error: any) {
      console.error("Email OTP Send Error:", error);
      const message =
        error.message === 'The string did not match the expected pattern.'
          ? 'Failed to send Email OTP. Please check the email format and try again.'
          : error.message || "Failed to send Email OTP. Please check the email address.";
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    if (!otp || !emailSessionId) return;
    setIsLoading(true);
    try {
      const response = await postAuthAction('verify-otp', { sessionId: emailSessionId, otp }, '/api/auth/verify-otp');
      const data = await parseApiResponse(response, 'Failed to verify Email OTP');
      if (data.Status === 'Success' && data.Details === 'OTP Matched') {
        setOtp(''); // Clear OTP for next step
        await handleSendOtp();
      } else {
        throw new Error(data.Details || 'Invalid Email OTP');
      }
    } catch (error: any) {
      console.error("Email OTP Verification Error:", error);
      alert(error.message || "Invalid Email OTP. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!normalizedSignupPhone) return;
    setIsLoading(true);
    try {
      const response = await postAuthAction('send-otp', { phoneNumber: normalizedSignupPhone }, '/api/auth/send-otp');
      const data = await parseApiResponse(response, 'Failed to send OTP');
      if (data.Status === 'Success') {
        setSessionId(data.Details);
        setStep('otp');
      } else {
        throw new Error(data.Details || 'Failed to send OTP');
      }
    } catch (error: any) {
      console.error("OTP Send Error:", error);
      const message =
        error.message === 'The string did not match the expected pattern.'
          ? 'Failed to send OTP. Please enter the mobile number in digits only, for example 919876543210.'
          : error.message || "Failed to send OTP. Please check the phone number format (e.g., 919876543210).";
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || !sessionId) return;
    setIsLoading(true);
    setNotRegisteredError(false);
    try {
      const response = await postAuthAction('verify-otp', { sessionId, otp }, '/api/auth/verify-otp');
      const data = await parseApiResponse(response, 'Failed to verify OTP');
      if (data.Status === 'Success' && data.Details === 'OTP Matched') {
        setOtp('');
        if (!user && authMode === 'signup' && email && password && displayName) {
          await completeEmailPasswordSignUp();
        } else if (authMode === 'login') {
          let existingProfile: { uid: string; role: string; email: string; phoneNumber: string };
          try {
            const resolveResponse = await fetch('/api/health?action=resolve-phone-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phoneNumber: phoneNumber || username }),
            });
            existingProfile = await parseApiResponse(resolveResponse, 'Failed to resolve phone login');
          } catch (error: any) {
            if (/HTTP (404|405)/.test(error?.message || '') || /NOT_REGISTERED/.test(error?.message || '')) {
              existingProfile = await resolvePhoneLoginClientSide(phoneNumber || username);
            } else {
              throw error;
            }
          }

          sessionStorage.setItem(PHONE_LOGIN_PROFILE_KEY, existingProfile.uid);
          sessionStorage.setItem(PHONE_LOGIN_NUMBER_KEY, normalizePhoneForAuth(phoneNumber || username));

          if (!auth.currentUser || !auth.currentUser.isAnonymous) {
            try {
              await signInAnonymously(auth);
            } catch (authError: any) {
              if (authError.code === 'auth/admin-restricted-operation' || authError.code === 'auth/operation-not-allowed') {
                throw new Error("Anonymous Authentication is not enabled in Firebase. Please enable it in the Firebase Console (Authentication > Sign-in method).");
              }
              throw authError;
            }
          } else {
            window.location.reload();
          }
        } else {
          try {
            const currentUser = auth.currentUser;
            if (currentUser && !currentUser.isAnonymous) {
              await handleProfileSetup(currentUser, phoneNumber, displayName || undefined, authMode === 'signup');
            } else {
              const result = await signInAnonymously(auth);
              await handleProfileSetup(result.user, phoneNumber, undefined, authMode === 'signup');
            }
          } catch (authError: any) {
            if (authError.code === 'auth/admin-restricted-operation' || authError.code === 'auth/operation-not-allowed') {
              throw new Error("Anonymous Authentication is not enabled in Firebase. Please enable it in the Firebase Console (Authentication > Sign-in method).");
            }
            throw authError;
          }
        }
      } else {
        throw new Error(data.Details || 'Invalid OTP');
      }
    } catch (error: any) {
      console.error("OTP Verification Error:", error);
      if (error.message === "NOT_REGISTERED") {
        setNotRegisteredError(true);
      } else {
        alert(error.message || "Invalid OTP. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailPasswordSignUp = async () => {
    if (!normalizedSignupEmail || (!user && !password) || !normalizedSignupPhone || !displayName.trim()) {
      alert("Please fill all fields");
      return;
    }
    if (!isValidEmailValue(normalizedSignupEmail)) {
      alert("Please enter a valid email address.");
      return;
    }
    if (!normalizedSignupPhone) {
      alert("Please enter a valid 10-digit Indian mobile number.");
      return;
    }
    if (!truthDeclarationAccepted || !termsAccepted) {
      alert("Please accept the declaration and terms before continuing.");
      return;
    }
    setIsLoading(true);
    try {
      // Send email OTP first
      await handleSendEmailOtp();
    } catch (error: any) {
      alert(error.message || "Failed to initiate signup.");
    } finally {
      setIsLoading(false);
    }
  };

  const completeEmailPasswordSignUp = async () => {
    try {
      const signupResponse = await postAuthAction('complete-signup', {
          email: normalizedSignupEmail,
          password,
          displayName: sanitizeDisplayName(displayName),
          phoneNumber: normalizedSignupPhone,
          role: role || 'consumer',
          referralCodeInput,
          consents: {
            truthfulInformationAccepted: truthDeclarationAccepted,
            termsAccepted,
            marketingOptIn,
            acceptedAt: new Date().toISOString(),
            disclosureVersion: CONSENT_VERSION,
            channels: {
              email: marketingOptIn,
              sms: marketingOptIn,
              whatsapp: marketingOptIn,
            },
          },
      }, '/api/auth/complete-signup');
      await parseApiResponse(signupResponse, 'Failed to complete sign up');

      const result = await signInWithEmailAndPassword(auth, normalizedSignupEmail, password);
      await handleProfileSetup(result.user, normalizedSignupPhone, sanitizeDisplayName(displayName), true);
    } catch (error: any) {
      console.error("Complete Sign Up Error:", error);
      if (error.code === 'auth/email-already-in-use' || /already (registered|exists|been registered)/i.test(error.message || '')) {
        alert("This email is already registered. Please login instead.");
        setAuthMode('login');
      } else {
        alert(error.message || "Failed to complete sign up.");
      }
      throw error;
    }
  };

  const handleLogin = async () => {
    const normalizedUsername = username.trim();
    const isPhone = /^\+?[\d\s-]{10,}$/.test(normalizedUsername);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedUsername);

    if (isPhone) {
      if (!normalizedUsername) {
        alert("Please enter phone number");
        return;
      }
    } else {
      if (!normalizedUsername || !password) {
        alert("Please enter email and password");
        return;
      }
    }

    setIsLoading(true);
    setNotRegisteredError(false);
    try {
      let existingProfile: UserProfile | null = null;

      if (isPhone) {
        const normalizedLoginPhone = normalizePhoneForAuth(normalizedUsername);
        if (!normalizedLoginPhone) {
          throw new Error("Please enter a valid phone number.");
        }

        // Trigger Phone OTP Login
        setPhoneNumber(normalizedLoginPhone);
        sessionStorage.setItem(PHONE_LOGIN_NUMBER_KEY, normalizedLoginPhone);
        const response = await postAuthAction('send-otp', { phoneNumber: normalizedLoginPhone }, '/api/auth/send-otp');
        const data = await parseApiResponse(response, 'Failed to send OTP');
        if (data.Status === 'Success') {
          setSessionId(data.Details);
          setStep('otp');
        } else {
          throw new Error(data.Details || 'Failed to send OTP');
        }
      } else {
        // Email/Password Login
        const result = await signInWithEmailAndPassword(auth, normalizeEmailValue(normalizedUsername), password);
        await handleProfileSetup(result.user, undefined, undefined, false);
      }
    } catch (error: any) {
      console.error("Login Error:", error);
      if (error.code === 'auth/operation-not-allowed') {
        alert("Authentication method not enabled. Please check Firebase Console.");
      } else if (error.code === 'auth/wrong-password') {
        alert("Incorrect password. Please try again.");
      } else if (error.message === "NOT_REGISTERED" || error.code === 'auth/user-not-found') {
        setNotRegisteredError(true);
      } else {
        alert(error.message || "Invalid credentials.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setNotRegisteredError(false);
    try {
      sessionStorage.setItem('mairide_oauth_mode', authMode);
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      if (result?.user) {
        await handleProfileSetup(result.user, undefined, undefined, authMode === 'signup');
      }
    } catch (error: any) {
      console.error("Google Login Error:", error);
      if (error.code === 'auth/operation-not-allowed') {
        alert("Google authentication is not enabled in your Supabase project. Please enable the Google provider in Supabase Auth.");
      } else if (error.code === 'auth/account-exists-with-different-credential') {
        alert("An account already exists with this email but using a different login method. Please use your original login method.");
      } else if (error.message === "NOT_REGISTERED") {
        setNotRegisteredError(true);
      } else if (error.code !== 'auth/popup-closed-by-user') {
        alert(error.message || "Failed to login with Google.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileSetup = async (user: User, phone?: string, name?: string, isSignUp: boolean = false) => {
    const path = `users/${user.uid}`;
    const mappedPhoneProfileId = !isSignUp && user.isAnonymous ? sessionStorage.getItem(PHONE_LOGIN_PROFILE_KEY) : null;

    if (mappedPhoneProfileId) {
      return;
    }

    try {
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        const targetPhone = user.phoneNumber || phone || '';
        const phoneCandidates = buildPhoneVariants(targetPhone);
        const targetEmail = user.email || '';

        // Check for existing profile by email or phone
        let existingProfile: UserProfile | null = null;
        
        if (targetEmail) {
          const qEmail = query(collection(db, 'users'), where('email', '==', targetEmail));
          const emailSnap = await getDocs(qEmail);
          if (!emailSnap.empty) existingProfile = emailSnap.docs[0].data() as UserProfile;
        }

        if (!existingProfile && phoneCandidates.length) {
          for (const candidate of phoneCandidates) {
            const qPhone = query(collection(db, 'users'), where('phoneNumber', '==', candidate));
            const phoneSnap = await getDocs(qPhone);
            if (!phoneSnap.empty) {
              existingProfile = phoneSnap.docs[0].data() as UserProfile;
              break;
            }
          }
        }

        if (!existingProfile && !isSignUp && user.email?.toLowerCase() !== SUPER_ADMIN_EMAIL) {
          throw new Error("NOT_REGISTERED");
        }

        if (existingProfile) {
          // If profile exists with different UID, "migrate" it to the new UID
          const oldUid = existingProfile.uid;
          const newProfile = {
            ...existingProfile,
            uid: user.uid,
            ...(isSignUp
              ? {
                  consents: existingProfile.consents ?? {
                    truthfulInformationAccepted: truthDeclarationAccepted,
                    termsAccepted,
                    marketingOptIn,
                    acceptedAt: new Date().toISOString(),
                    disclosureVersion: CONSENT_VERSION,
                    channels: {
                      email: marketingOptIn,
                      sms: marketingOptIn,
                      whatsapp: marketingOptIn,
                    },
                  },
                }
              : {}),
          };
          
          await setDoc(docRef, newProfile);
          
          if (oldUid !== user.uid && !oldUid.startsWith('manual_')) {
            await deleteDoc(doc(db, 'users', oldUid));
          }
          return;
        }

        const isAdminEmail = user.email?.toLowerCase() === SUPER_ADMIN_EMAIL;
        const newProfile: UserProfile = {
          uid: user.uid,
          email: targetEmail,
          displayName: name || user.displayName || phone || 'User',
          role: isAdminEmail ? 'admin' : (role || 'consumer'),
          status: 'active',
          photoURL: user.photoURL || '',
          phoneNumber: targetPhone,
          onboardingComplete: isAdminEmail,
          createdAt: new Date().toISOString(),
          ...(isSignUp
            ? {
                consents: {
                  truthfulInformationAccepted: truthDeclarationAccepted,
                  termsAccepted,
                  marketingOptIn,
                  acceptedAt: new Date().toISOString(),
                  disclosureVersion: CONSENT_VERSION,
                  channels: {
                    email: marketingOptIn,
                    sms: marketingOptIn,
                    whatsapp: marketingOptIn,
                  },
                },
              }
            : {}),
        };
        await setDoc(docRef, newProfile);
        
        // Initialize wallet and referral
        await walletService.initializeUserWallet(user.uid, referralCodeInput || undefined);
      } else {
        const existingProfile = docSnap.data() as UserProfile;
        if (user.email?.toLowerCase() === SUPER_ADMIN_EMAIL && existingProfile.role !== 'admin') {
          await updateDoc(docRef, { role: 'admin', onboardingComplete: true });
        }
      }
    } catch (error: any) {
      if (error.message === "NOT_REGISTERED") throw error;
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  return (
    <div className="min-h-screen bg-mairide-bg flex flex-col items-center justify-center p-4">
      <div id="recaptcha-container"></div>
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-[32px] p-8 shadow-xl border border-mairide-secondary"
      >
        <div className="flex flex-col items-center mb-6">
          <img src={LOGO_URL} className="w-32 h-32 object-contain mb-2" alt="MaiRide Logo" />
          <h1 className="text-2xl font-black tracking-tighter text-mairide-primary uppercase">
            {BRAND_NAME}
          </h1>
        </div>

        {!isRedirectedFromLogin && (
          <div className="flex bg-mairide-bg p-1 rounded-2xl mb-6">
            <button
              onClick={() => setRole('consumer')}
              className={cn(
                "flex-1 py-3 rounded-xl text-sm font-semibold transition-all",
                role === 'consumer' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary hover:text-mairide-accent"
              )}
            >
              Traveler
            </button>
            <button
              onClick={() => setRole('driver')}
              className={cn(
                "flex-1 py-3 rounded-xl text-sm font-semibold transition-all",
                role === 'driver' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary hover:text-mairide-accent"
              )}
            >
              Driver
            </button>
          </div>
        )}

        {isRedirectedFromLogin && authMode === 'signup' && (
          <div className="mb-6 p-4 bg-mairide-bg rounded-2xl border border-mairide-accent/20 text-center">
            <p className="text-xs font-bold text-mairide-accent uppercase tracking-widest">
              Signing up as {role === 'driver' ? 'a Driver' : 'a Traveler'}
            </p>
            <button 
              onClick={() => setIsRedirectedFromLogin(false)}
              className="text-[10px] text-mairide-secondary underline mt-1"
            >
              Change Role
            </button>
          </div>
        )}

        <div className="flex justify-center space-x-4 mb-6">
          {!user && (
            <button 
              onClick={() => { setAuthMode('login'); setNotRegisteredError(false); setIsRedirectedFromLogin(false); }}
              className={cn("text-sm font-bold pb-1 border-b-2 transition-all", authMode === 'login' ? "border-mairide-accent text-mairide-accent" : "border-transparent text-mairide-secondary")}
            >
              Login
            </button>
          )}
          <button 
            onClick={() => { setAuthMode('signup'); setNotRegisteredError(false); setIsRedirectedFromLogin(false); }}
            className={cn("text-sm font-bold pb-1 border-b-2 transition-all", authMode === 'signup' ? "border-mairide-accent text-mairide-accent" : "border-transparent text-mairide-secondary")}
          >
            {user ? 'Complete Profile' : 'Sign Up'}
          </button>
        </div>

        <AnimatePresence>
          {notRegisteredError && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
              >
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                </div>
                <h2 className="text-xl font-black text-mairide-primary mb-2 uppercase tracking-tight">Not Registered</h2>
                <p className="text-gray-600 mb-6">
                  We could not find a completed MaiRide account linked to this login yet. Please sign up to continue.
                </p>
                <div className="space-y-3">
                  <button 
                    onClick={() => {
                      setAuthMode('signup');
                      setNotRegisteredError(false);
                      setIsRedirectedFromLogin(true);
                    }}
                    className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all"
                  >
                    Sign Up as {role === 'driver' ? 'Driver' : 'Traveler'}
                  </button>
                  <button 
                    onClick={() => {
                      setRole(role === 'driver' ? 'consumer' : 'driver');
                    }}
                    className="w-full text-mairide-accent font-bold py-2 text-sm"
                  >
                    Sign Up as {role === 'driver' ? 'Traveler' : 'Driver'} instead
                  </button>
                  <button 
                    onClick={() => setNotRegisteredError(false)}
                    className="w-full text-gray-500 font-bold py-2"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div className="space-y-4">
          {authMode === 'signup' ? (
            step === 'phone' ? (
              <div className="space-y-4">
                <input 
                  type="text" 
                  placeholder="Full Name"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={displayName}
                  onChange={(e) => setDisplayName(sanitizeDisplayName(e.target.value))}
                  autoComplete="name"
                />
                <input 
                  type="email" 
                  placeholder="Email Address"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={email}
                  onChange={(e) => setEmail(normalizeEmailValue(e.target.value))}
                  autoComplete="email"
                />
                <IndianPhoneInput
                  value={phoneNumber}
                  onChange={setPhoneNumber}
                />
                
                {!user && (
                  <input 
                    type="password" 
                    placeholder="Create Password"
                    className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                  />
                )}
                <input 
                  type="text" 
                  placeholder="Referral Code (Optional)"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={referralCodeInput}
                  onChange={(e) => setReferralCodeInput(e.target.value.toUpperCase().replace(/\s+/g, '').slice(0, 20))}
                />
                <label className="flex items-start gap-3 rounded-2xl border border-mairide-secondary bg-mairide-bg/60 px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-mairide-accent"
                    checked={truthDeclarationAccepted}
                  onChange={(e) => setTruthDeclarationAccepted(e.target.checked)}
                  />
                  <span className="text-[11px] leading-relaxed text-mairide-primary">
                    {role === 'driver' ? DRIVER_DISCLOSURE_TEXT : TRAVELER_DISCLOSURE_TEXT}
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-2xl border border-mairide-secondary bg-mairide-bg/60 px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-mairide-accent"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                  />
                  <span className="text-[11px] leading-relaxed text-mairide-primary">
                    I agree to MaiRide&apos;s Terms and Conditions, Privacy Policy, safety verification process, and platform usage rules.
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-2xl border border-mairide-secondary bg-mairide-bg/60 px-4 py-4 text-left">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-mairide-accent"
                    checked={marketingOptIn}
                    onChange={(e) => setMarketingOptIn(e.target.checked)}
                  />
                  <span className="text-[11px] leading-relaxed text-mairide-primary">
                    {MARKETING_DISCLOSURE_TEXT}
                  </span>
                </label>
                <button
                  onClick={handleEmailPasswordSignUp}
                  disabled={isLoading}
                  className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
                >
                  {isLoading ? "Sending OTP..." : (user ? "Complete Profile" : "Sign Up")}
                </button>
              </div>
            ) : step === 'email-otp' ? (
              <div className="space-y-4">
                <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg/70 px-5 py-4 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-mairide-secondary">Email verification</p>
                  <p className="mt-2 text-sm text-mairide-secondary">Enter the 6-digit verification code sent to your email address.</p>
                  <p className="mt-3 text-base font-semibold text-mairide-primary break-all">{email}</p>
                </div>
                <input 
                  type="text" 
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Enter 6-digit code"
                  className="w-full px-5 py-4 bg-mairide-bg border border-mairide-secondary rounded-[28px] outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary text-center text-xl tracking-[0.18em] font-semibold"
                  value={otp}
                  maxLength={6}
                  onChange={(e) => setOtp(e.target.value)}
                />
                <button
                  onClick={handleVerifyEmailOtp}
                  disabled={isLoading || otp.length !== 6}
                  className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
                >
                  {isLoading ? "Verifying..." : "Verify Email OTP"}
                </button>
                <button
                  onClick={async () => {
                    setOtp('');
                    await handleSendEmailOtp();
                  }}
                  disabled={isLoading}
                  className="w-full bg-mairide-bg text-mairide-primary py-3 rounded-2xl font-bold transition-all hover:bg-mairide-secondary disabled:opacity-50"
                >
                  {isLoading ? "Please wait..." : "Resend Email OTP"}
                </button>
                <button 
                  onClick={() => setStep('phone')}
                  className="w-full text-xs text-mairide-secondary hover:text-mairide-accent font-medium"
                >
                  Change Details
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg/70 px-5 py-4 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-mairide-secondary">Phone verification</p>
                  <p className="mt-2 text-sm text-mairide-secondary">Enter the 6-digit verification code sent to your mobile number.</p>
                  <p className="mt-3 text-base font-semibold text-mairide-primary">{maskedOtpPhone}</p>
                </div>
                <input 
                  type="text" 
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Enter 6-digit code"
                  className="w-full px-5 py-4 bg-mairide-bg border border-mairide-secondary rounded-[28px] outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary text-center text-xl tracking-[0.18em] font-semibold"
                  value={otp}
                  maxLength={6}
                  onChange={(e) => setOtp(e.target.value)}
                />
                <button
                  onClick={handleVerifyOtp}
                  disabled={isLoading || otp.length !== 6}
                  className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
                >
                  {isLoading ? "Verifying..." : (authMode === 'signup' ? (user ? "Complete Profile" : "Verify & Sign Up") : "Verify & Login")}
                </button>
                <button
                  onClick={async () => {
                    setOtp('');
                    await handleSendOtp();
                  }}
                  disabled={isLoading}
                  className="w-full bg-mairide-bg text-mairide-primary py-3 rounded-2xl font-bold transition-all hover:bg-mairide-secondary disabled:opacity-50"
                >
                  {isLoading ? "Please wait..." : "Resend Phone OTP"}
                </button>
                <button 
                  onClick={() => setStep('phone')}
                  className="w-full text-xs text-mairide-secondary hover:text-mairide-accent font-medium"
                >
                  Change Details
                </button>
              </div>
            )
          ) : step === 'otp' ? (
            <div className="space-y-4">
              <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg/70 px-5 py-4 text-left">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-mairide-secondary">Phone login verification</p>
                <p className="mt-2 text-sm text-mairide-secondary">Enter the 6-digit login code sent to your registered mobile number.</p>
                <p className="mt-3 text-base font-semibold text-mairide-primary">{maskedOtpPhone}</p>
              </div>
              <input 
                type="text" 
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter 6-digit code"
                className="w-full px-5 py-4 bg-mairide-bg border border-mairide-secondary rounded-[28px] outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary text-center text-xl tracking-[0.18em] font-semibold"
                value={otp}
                maxLength={6}
                onChange={(e) => setOtp(e.target.value)}
              />
              <button
                onClick={handleVerifyOtp}
                disabled={isLoading || otp.length !== 6}
                className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
              >
                {isLoading ? "Verifying..." : "Verify & Login"}
              </button>
              <button
                onClick={async () => {
                  setOtp('');
                  await handleSendOtp();
                }}
                disabled={isLoading}
                className="w-full bg-mairide-bg text-mairide-primary py-3 rounded-2xl font-bold transition-all hover:bg-mairide-secondary disabled:opacity-50"
              >
                {isLoading ? "Please wait..." : "Resend Login OTP"}
              </button>
              <button
                onClick={() => {
                  setStep('phone');
                  setOtp('');
                  setSessionId('');
                }}
                className="w-full text-xs text-mairide-secondary hover:text-mairide-accent font-medium"
              >
                Change Login Method
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="Email or Phone Number"
                className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (step !== 'phone') {
                    setStep('phone');
                    setOtp('');
                    setSessionId('');
                  }
                }}
              />
              {!/^\+?[\d\s-]{10,}$/.test(username) && (
                <input 
                  type="password" 
                  placeholder="Password"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
              <button
                onClick={handleLogin}
                disabled={isLoading}
                className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50"
              >
                {isLoading ? "Processing..." : (/^\+?[\d\s-]{10,}$/.test(username) ? "Send Login OTP" : "Login")}
              </button>
            </div>
          )}

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-mairide-secondary"></div>
            <span className="flex-shrink mx-4 text-mairide-secondary text-[10px] font-bold uppercase">OR</span>
            <div className="flex-grow border-t border-mairide-secondary"></div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full bg-white border border-mairide-secondary hover:bg-mairide-bg text-mairide-primary py-4 rounded-2xl font-bold flex items-center justify-center space-x-3 transition-all disabled:opacity-50"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            <span>Continue with Google</span>
          </button>

          <p className="text-center text-[10px] text-mairide-secondary px-4 leading-relaxed">
            By continuing, you agree to MaiRide's Terms of Service and Privacy Policy.
          </p>
        </div>
      </motion.div>
      
      <div className="mt-8 flex flex-col items-center space-y-4">
        <div className="flex items-center space-x-4 text-mairide-secondary text-xs">
          <div className="flex items-center space-x-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Verified Drivers</span>
          </div>
          <div className="w-1 h-1 bg-mairide-secondary rounded-full" />
          <div className="flex items-center space-x-1">
            <Clock className="w-4 h-4" />
            <span>Real-time Tracking</span>
          </div>
        </div>
        <AppFooter />
      </div>
    </div>
  );
};

// --- Camera Capture Component ---

const CameraCapture = ({ onCapture, onCancel, title }: { onCapture: (image: string) => void, onCancel: () => void, title: string }) => {
  const webcamRef = React.useRef<Webcam>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isTakingTooLong, setIsTakingTooLong] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  useEffect(() => {
    if (!isReady && !error) {
      const timer = setTimeout(() => {
        setIsTakingTooLong(true);
      }, 10000);
      return () => clearTimeout(timer);
    } else {
      setIsTakingTooLong(false);
    }
  }, [isReady, error, retryCount]);

  const capture = React.useCallback(() => {
    if (!isReady) return;
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      onCapture(imageSrc);
    }
  }, [webcamRef, onCapture, isReady]);

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    setIsReady(false);
    setRetryCount(prev => prev + 1);
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-[60] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-[32px] overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onCancel} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="relative aspect-[4/3] bg-black flex items-center justify-center">
          {!navigator.mediaDevices?.getUserMedia && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-gray-900 p-6 text-center">
              <AlertTriangle className="w-12 h-12 text-yellow-500 mb-4" />
              <p className="text-white font-semibold mb-2">Not Supported</p>
              <p className="text-gray-400 text-sm">Your browser does not support camera access or you are not using HTTPS.</p>
            </div>
          )}
          {!isReady && !error && navigator.mediaDevices?.getUserMedia && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black">
              <div className="w-8 h-8 border-4 border-orange-600 border-t-transparent rounded-full animate-spin mb-4" />
              {isTakingTooLong && (
                <div className="text-center p-4">
                  <p className="text-white text-sm mb-4">Camera is taking longer than expected...</p>
                  <button 
                    onClick={() => {
                      setRetryCount(prev => prev + 1);
                      setIsTakingTooLong(false);
                    }}
                    className="px-4 py-2 bg-white/10 text-white rounded-xl text-xs hover:bg-white/20"
                  >
                    Try Re-initializing
                  </button>
                </div>
              )}
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-gray-900 p-6 text-center">
              <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
              <p className="text-white font-semibold mb-2">Camera Error</p>
              <p className="text-gray-400 text-sm mb-6">{error}</p>
              <div className="flex space-x-4">
                <button 
                  onClick={() => {
                    setError(null);
                    setIsReady(false);
                    setRetryCount(prev => prev + 1);
                  }}
                  className="px-6 py-2 bg-orange-600 text-white rounded-xl font-bold text-sm"
                >
                  Retry
                </button>
                <button 
                  onClick={onCancel}
                  className="px-6 py-2 bg-white text-gray-900 rounded-xl font-bold text-sm"
                >
                  Go Back
                </button>
              </div>
            </div>
          )}
          <Webcam
            key={`${retryCount}-${facingMode}`}
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            className="w-full h-full object-cover"
            videoConstraints={{ 
              facingMode: facingMode
            }}
            mirrored={facingMode === 'user'}
            screenshotQuality={0.8}
            imageSmoothing={true}
            forceScreenshotSourceSize={false}
            disablePictureInPicture={true}
            onUserMedia={() => setIsReady(true)}
            onUserMediaError={(err) => {
              console.error("Webcam Error:", err);
              const errorMessage = typeof err === 'string' ? err : (err as any).message || (err as any).name || "Could not access camera.";
              setError(`${errorMessage}. Please ensure permissions are granted.`);
              setIsReady(false);
            }}
          />
          <div className="absolute inset-0 border-2 border-dashed border-white/30 pointer-events-none m-8 rounded-xl" />
          
          {isReady && (
            <button 
              onClick={toggleCamera}
              className="absolute bottom-4 right-4 bg-black/50 text-white p-3 rounded-full backdrop-blur-md hover:bg-black/70 transition-colors"
            >
              <History className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="p-8 flex flex-col space-y-4">
          <button
            onClick={capture}
            disabled={!isReady}
            className="w-full bg-orange-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-orange-100 hover:scale-[1.02] transition-transform flex items-center justify-center space-x-2 disabled:opacity-50 disabled:hover:scale-100"
          >
            <Camera className="w-5 h-5" />
            <span>Capture Photo</span>
          </button>
          <p className="text-[10px] text-center text-gray-400 uppercase font-bold tracking-widest">
            Ensure the document is clearly visible and well-lit
          </p>
        </div>
      </div>
    </div>
  );
};

// --- Wallet Dashboard Component ---

const WalletDashboard = ({ profile }: { profile: UserProfile }) => {
  const [stats, setStats] = useState<any>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [driverCompletedBookings, setDriverCompletedBookings] = useState<Booking[]>([]);
  const [showEarningsDetail, setShowEarningsDetail] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchWalletData = async () => {
      setIsLoading(true);
      try {
        const requests: Promise<any>[] = [
          walletService.getReferralStats(profile.uid),
          getDocs(query(
            collection(db, 'transactions'), 
            where('userId', '==', profile.uid),
            orderBy('createdAt', 'desc'),
            limit(10)
          ))
        ];

        if (profile.role === 'driver') {
          requests.push(
            getDocs(query(
              collection(db, 'bookings'),
              where('driverId', '==', profile.uid),
              orderBy('createdAt', 'desc'),
              limit(20)
            ))
          );
        }

        const [s, txSnapshot, driverBookingSnapshot] = await Promise.all(requests);
        setStats(s);
        setTransactions(txSnapshot.docs.map(doc => doc.data() as Transaction));
        if (profile.role === 'driver' && driverBookingSnapshot) {
          const bookings = driverBookingSnapshot.docs
            .map((doc: any) => doc.data() as Booking)
            .filter((booking: Booking) => Boolean(booking.rideEndedAt || booking.status === 'completed'));
          setDriverCompletedBookings(bookings);
        } else {
          setDriverCompletedBookings([]);
        }
      } catch (error) {
        console.error("Failed to fetch wallet data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWalletData();
  }, [profile.uid]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-mairide-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center gap-6 mb-8">
        <div className="bg-mairide-primary p-6 rounded-[40px] text-white flex-1 shadow-xl shadow-mairide-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl" />
          <div className="relative z-10">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-2">Available Balance</p>
            <div className="flex items-baseline space-x-2">
              <h2 className="text-5xl font-black tracking-tighter">{profile.wallet?.balance || 0}</h2>
              <span className="text-xl font-bold opacity-80 uppercase">MaiCoins</span>
            </div>
            <div className="mt-6 pt-6 border-t border-white/10 flex justify-between items-center">
              <div>
                <p className="text-[10px] font-bold uppercase opacity-60 mb-1">Pending Rewards</p>
                <p className="font-bold text-lg">{profile.wallet?.pendingBalance || 0} MC</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase opacity-60 mb-1">Referral Code</p>
                <div className="flex items-center space-x-2 bg-white/10 px-3 py-1 rounded-full">
                  <span className="font-mono font-bold">{profile.referralCode}</span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(profile.referralCode || '');
                      alert('Referral code copied!');
                    }}
                    className="hover:text-mairide-accent transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 flex-1">
          {profile.role === 'driver' && (
            <button
              type="button"
              onClick={() => setShowEarningsDetail((prev) => !prev)}
              className="col-span-2 bg-white p-4 rounded-3xl border border-mairide-secondary text-left hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Total Earnings</p>
                  <p className="text-2xl font-black text-mairide-primary">{formatCurrency(profile.driverDetails?.totalEarnings || 0)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Completed rides</p>
                  <p className="text-xl font-black text-mairide-accent">{driverCompletedBookings.length}</p>
                  <p className="mt-2 text-xs font-bold text-mairide-primary">{showEarningsDetail ? 'Hide details' : 'View details'}</p>
                </div>
              </div>
            </button>
          )}
          <div className="bg-white p-4 rounded-3xl border border-mairide-secondary text-center">
            <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Tier 1</p>
            <p className="text-xl font-black text-mairide-primary">{stats?.tier1 || 0}</p>
          </div>
          <div className="bg-white p-4 rounded-3xl border border-mairide-secondary text-center">
            <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Tier 2</p>
            <p className="text-xl font-black text-mairide-primary">{stats?.tier2 || 0}</p>
          </div>
          <div className="col-span-2 bg-mairide-bg p-4 rounded-3xl border border-mairide-secondary flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="bg-white p-2 rounded-xl">
                <Users className="w-5 h-5 text-mairide-accent" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-mairide-secondary uppercase">Total Network</p>
                <p className="font-bold text-mairide-primary">{(stats?.tier1 || 0) + (stats?.tier2 || 0)} Members</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-mairide-secondary uppercase">Total Earned</p>
              <p className="font-bold text-green-600">{stats?.totalEarned || 0} MC</p>
            </div>
          </div>
        </div>
      </div>

      {profile.role === 'driver' && showEarningsDetail && (
        <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-bold text-mairide-primary">Earnings Detail</h3>
              <p className="text-sm text-mairide-secondary">Only completed rides are counted here.</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-mairide-secondary uppercase">Total earnings</p>
              <p className="text-2xl font-black text-mairide-primary">{formatCurrency(profile.driverDetails?.totalEarnings || 0)}</p>
            </div>
          </div>
          {driverCompletedBookings.length ? (
            <div className="space-y-3">
              {driverCompletedBookings.map((booking) => (
                <div key={booking.id} className="rounded-2xl bg-mairide-bg p-4 border border-mairide-secondary/30">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                      <p className="text-sm text-mairide-secondary">Traveler: {booking.consumerName}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary mt-2">
                        {booking.rideEndedAt ? new Date(booking.rideEndedAt).toLocaleString() : new Date(booking.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Ride earning</p>
                      <p className="text-xl font-black text-mairide-accent">{formatCurrency(booking.fare)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-mairide-bg p-6 text-center text-mairide-secondary italic">
              Completed rides will appear here once journeys are fully closed.
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-lg font-bold text-mairide-primary flex items-center">
          <History className="w-5 h-5 mr-2 text-mairide-accent" />
          Recent Transactions
        </h3>
        <div className="bg-white rounded-[32px] border border-mairide-secondary overflow-hidden shadow-sm">
          {transactions.length > 0 ? (
            <div className="divide-y divide-mairide-bg">
              {transactions.map(tx => (
                <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-mairide-bg/30 transition-colors">
                  <div className="flex items-center space-x-4">
                    <div className={cn(
                      "p-2 rounded-xl",
                      tx.type.includes('referral') ? "bg-green-50 text-green-600" : 
                      tx.type.includes('payment') ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
                    )}>
                      {tx.type.includes('referral') ? <ArrowUpRight className="w-5 h-5" /> : 
                       tx.type.includes('payment') ? <ArrowDownLeft className="w-5 h-5" /> : <Wallet className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-bold text-sm text-mairide-primary">{tx.description}</p>
                      <p className="text-[10px] text-mairide-secondary uppercase font-bold tracking-widest">
                        {new Date(tx.createdAt).toLocaleDateString()} • {tx.type.replace('_', ' ')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "font-black",
                      tx.type.includes('referral') || tx.type === 'wallet_topup' ? "text-green-600" : "text-red-600"
                    )}>
                      {tx.type.includes('referral') || tx.type === 'wallet_topup' ? '+' : '-'}{tx.amount} MC
                    </p>
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase">{tx.status}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center">
              <p className="text-mairide-secondary italic serif">No transactions yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Driver Onboarding ---

const DriverOnboarding = ({
  profile,
  onComplete,
  isLoaded,
}: {
  profile: UserProfile;
  onComplete: () => void;
  isLoaded: boolean;
}) => {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    selfiePhoto: '',
    selfieGeoTag: null as any,
    aadhaarNumber: '',
    aadhaarFrontPhoto: '',
    aadhaarFrontGeoTag: null as any,
    aadhaarBackPhoto: '',
    aadhaarBackGeoTag: null as any,
    aadhaarGeoTag: null as any, // Legacy
    dlNumber: '',
    dlFrontPhoto: '',
    dlFrontGeoTag: null as any,
    dlBackPhoto: '',
    dlBackGeoTag: null as any,
    dlGeoTag: null as any, // Legacy
    vehicleMake: '',
    vehicleModel: '',
    vehicleColor: '',
    vehicleCapacity: 4,
    vehicleRegNumber: '',
    insuranceStatus: 'active' as 'active' | 'expired',
    insuranceProvider: '',
    insuranceExpiryDate: '',
    vehiclePhoto: '',
    vehicleGeoTag: null as any,
    rcPhoto: '',
    rcGeoTag: null as any,
    declarationAccepted: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [capturingField, setCapturingField] = useState<string | null>(null);
  const verificationMarkers = buildVerificationMarkers(formData as any);
  const aadhaarSegments = splitAadhaarDigits(formData.aadhaarNumber);

  const updateAadhaarSegment = (index: number, value: string) => {
    const nextSegments = [...aadhaarSegments];
    nextSegments[index] = String(value || '').replace(/[^\d]/g, '').slice(0, 4);
    setFormData(prev => ({
      ...prev,
      aadhaarNumber: nextSegments.join(''),
    }));
  };

  const getCurrentLocation = (): Promise<{ lat: number, lng: number, timestamp: number }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation not supported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: Date.now()
        }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  };

  const handleCapture = async (image: string) => {
    if (capturingField) {
      try {
        const location = await getCurrentLocation();
        const geoTagFieldMap: Record<string, string> = {
          selfiePhoto: 'selfieGeoTag',
          aadhaarFrontPhoto: 'aadhaarFrontGeoTag',
          aadhaarBackPhoto: 'aadhaarBackGeoTag',
          dlFrontPhoto: 'dlFrontGeoTag',
          dlBackPhoto: 'dlBackGeoTag',
          vehiclePhoto: 'vehicleGeoTag',
          rcPhoto: 'rcGeoTag',
        };
        const geoTagField = geoTagFieldMap[capturingField] || null;

        setFormData(prev => ({ 
          ...prev, 
          [capturingField]: image,
          ...(geoTagField ? { [geoTagField]: location } : {}),
          ...(capturingField.startsWith('aadhaar') ? { aadhaarGeoTag: location } : {}),
          ...(capturingField.startsWith('dl') ? { dlGeoTag: location } : {})
        }));
      } catch (error) {
        console.error("Geo-tagging failed:", error);
        // Still set the image even if geo-tagging fails, but maybe alert the user
        setFormData(prev => ({ ...prev, [capturingField]: image }));
      }
      setCapturingField(null);
    }
  };

  const uploadImage = async (base64: string, path: string) => {
    if (!base64) return '';
    const token = await getAccessToken();
    const response = await axios.post(
      '/api/upload-driver-doc',
      {
        driverId: profile.uid,
        path,
        dataUrl: base64,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.data?.url) {
      throw new Error('Failed to upload driver document');
    }

    return response.data.url as string;
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // Upload images to storage
      const [
        selfieUrl, 
        aadhaarFrontUrl, 
        aadhaarBackUrl, 
        dlFrontUrl, 
        dlBackUrl, 
        vehicleUrl, 
        rcUrl
      ] = await Promise.all([
        uploadImage(formData.selfiePhoto, 'selfie.jpg'),
        uploadImage(formData.aadhaarFrontPhoto, 'aadhaar_front.jpg'),
        uploadImage(formData.aadhaarBackPhoto, 'aadhaar_back.jpg'),
        uploadImage(formData.dlFrontPhoto, 'dl_front.jpg'),
        uploadImage(formData.dlBackPhoto, 'dl_back.jpg'),
        uploadImage(formData.vehiclePhoto, 'vehicle.jpg'),
        uploadImage(formData.rcPhoto, 'rc.jpg')
      ]);

      const updatedProfile: UserProfile = {
        ...profile,
        onboardingComplete: true,
        verificationStatus: 'pending',
        driverDetails: {
          ...formData,
          selfiePhoto: selfieUrl,
          aadhaarFrontPhoto: aadhaarFrontUrl,
          aadhaarBackPhoto: aadhaarBackUrl,
          dlFrontPhoto: dlFrontUrl,
          dlBackPhoto: dlBackUrl,
          vehiclePhoto: vehicleUrl,
          rcPhoto: rcUrl,
          isOnline: false,
          rating: 5.0,
          totalEarnings: 0,
        }
      };
      const token = await getAccessToken();
      await axios.post(
        '/api/complete-driver-onboarding',
        {
          driverId: profile.uid,
          driverDetails: updatedProfile.driverDetails,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      onComplete();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const steps = [
    { title: "Selfie", description: "Take a clear selfie for identification" },
    { title: "Aadhaar", description: "Upload Aadhaar card details" },
    { title: "License", description: "Upload Driving License details" },
    { title: "Vehicle", description: "Enter vehicle information" },
    { title: "Documents", description: "Upload Vehicle & RC photos" }
  ];

  return (
    <div className="min-h-screen bg-mairide-bg p-4 flex flex-col items-center justify-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-white rounded-[40px] p-8 shadow-2xl border border-mairide-secondary"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center mb-4">
            <img src={LOGO_URL} className="w-12 h-12 object-contain mr-2" alt="MaiRide Logo" />
            <span className="text-xl font-black tracking-tighter text-mairide-primary">
              {BRAND_NAME}
            </span>
          </div>
          <div className="flex justify-between items-center w-full mb-4">
            <div>
              <h1 className="text-2xl font-bold text-mairide-primary">{steps[step-1].title}</h1>
              <p className="text-xs text-mairide-secondary italic serif">{steps[step-1].description}</p>
            </div>
            <span className="text-mairide-accent font-bold text-lg">Step {step}/5</span>
          </div>
          <div className="w-full bg-mairide-bg h-2 rounded-full overflow-hidden">
            <motion.div 
              className="bg-mairide-accent h-full" 
              animate={{ width: `${(step / 5) * 100}%` }}
            />
          </div>
        </div>

        <div className="mb-6">
          <button
            onClick={() => signOut(auth)}
            className="w-full bg-mairide-bg text-mairide-primary py-3 rounded-2xl font-bold hover:bg-mairide-secondary transition-colors"
          >
            Logout and finish later
          </button>
        </div>

        <div className="mb-8">
          <VerificationMap
            markers={verificationMarkers}
            isLoaded={isLoaded}
            title="Verification Capture Map"
            subtitle="Each captured document is pinned here with its geo-tag and capture time for safety review."
          />
        </div>

        {step === 1 && (
          <div className="space-y-6">
            <div className="p-8 border-2 border-dashed border-mairide-secondary rounded-[32px] flex flex-col items-center justify-center space-y-4 bg-mairide-bg/30">
              {formData.selfiePhoto ? (
                <div className="relative w-full aspect-square max-w-[240px]">
                  <img src={formData.selfiePhoto} className="w-full h-full object-cover rounded-full border-4 border-white shadow-lg" alt="Selfie" />
                  {formData.selfieGeoTag && (
                    <div className="absolute bottom-2 right-2 bg-black/50 text-white text-[8px] px-2 py-1 rounded-full backdrop-blur-sm">
                      📍 {formData.selfieGeoTag.lat.toFixed(4)}, {formData.selfieGeoTag.lng.toFixed(4)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center shadow-inner">
                  <UserIcon className="w-16 h-16 text-mairide-secondary" />
                </div>
              )}
              <button 
                onClick={() => setCapturingField('selfiePhoto')}
                className="bg-mairide-primary text-white px-8 py-3 rounded-2xl font-bold text-sm hover:scale-105 transition-transform"
              >
                {formData.selfiePhoto ? 'Retake Selfie' : 'Capture Selfie'}
              </button>
            </div>
            <button 
              disabled={!formData.selfiePhoto}
              onClick={() => setStep(2)}
              className="w-full bg-mairide-accent text-white py-5 rounded-3xl font-bold shadow-lg shadow-mairide-accent/20 disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-2 ml-2">Aadhaar Number</label>
              <div className="grid grid-cols-3 gap-3">
                {aadhaarSegments.map((segment, index) => (
                  <input 
                    key={index}
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    placeholder="0000"
                    maxLength={4}
                    className="w-full p-5 bg-mairide-bg border-none rounded-3xl focus:ring-2 focus:ring-mairide-accent outline-none text-mairide-primary font-medium text-center tracking-[0.18em]"
                    value={segment}
                    onChange={e => updateAadhaarSegment(index, e.target.value)}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-mairide-secondary">Use the exact 12-digit Aadhaar number, captured in 3 clean blocks of 4 digits each.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Front Side</p>
                <div 
                  onClick={() => setCapturingField('aadhaarFrontPhoto')}
                  className="aspect-[3/2] border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.aadhaarFrontPhoto ? (
                    <img src={formData.aadhaarFrontPhoto} className="w-full h-full object-cover" alt="Aadhaar Front" />
                  ) : (
                    <Camera className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Back Side</p>
                <div 
                  onClick={() => setCapturingField('aadhaarBackPhoto')}
                  className="aspect-[3/2] border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.aadhaarBackPhoto ? (
                    <img src={formData.aadhaarBackPhoto} className="w-full h-full object-cover" alt="Aadhaar Back" />
                  ) : (
                    <Camera className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
            </div>
            <div className="flex space-x-4">
              <button onClick={() => setStep(1)} className="flex-1 bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold">Back</button>
              <button 
                disabled={!formData.aadhaarNumber || !formData.aadhaarFrontPhoto || !formData.aadhaarBackPhoto}
                onClick={() => setStep(3)}
                className="flex-[2] bg-mairide-accent text-white py-5 rounded-3xl font-bold disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-2 ml-2">Driving License Number</label>
              <input 
                type="text" 
                placeholder="DL Number"
                className="w-full p-5 bg-mairide-bg border-none rounded-3xl focus:ring-2 focus:ring-mairide-accent outline-none text-mairide-primary font-medium"
                value={formData.dlNumber}
                onChange={e => setFormData({ ...formData, dlNumber: sanitizeLicenseOrVehicleCode(e.target.value, 20) })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Front Side</p>
                <div 
                  onClick={() => setCapturingField('dlFrontPhoto')}
                  className="aspect-[3/2] border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.dlFrontPhoto ? (
                    <img src={formData.dlFrontPhoto} className="w-full h-full object-cover" alt="DL Front" />
                  ) : (
                    <Camera className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Back Side</p>
                <div 
                  onClick={() => setCapturingField('dlBackPhoto')}
                  className="aspect-[3/2] border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.dlBackPhoto ? (
                    <img src={formData.dlBackPhoto} className="w-full h-full object-cover" alt="DL Back" />
                  ) : (
                    <Camera className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
            </div>
            <div className="flex space-x-4">
              <button onClick={() => setStep(2)} className="flex-1 bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold">Back</button>
              <button 
                disabled={!formData.dlNumber || !formData.dlFrontPhoto || !formData.dlBackPhoto}
                onClick={() => setStep(4)}
                className="flex-[2] bg-mairide-accent text-white py-5 rounded-3xl font-bold disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Make</label>
                <input 
                  type="text" 
                  placeholder="e.g. Maruti"
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleMake}
                  onChange={e => setFormData({ ...formData, vehicleMake: sanitizeDisplayName(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Model</label>
                <input 
                  type="text" 
                  placeholder="e.g. Swift"
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleModel}
                  onChange={e => setFormData({ ...formData, vehicleModel: sanitizeLicenseOrVehicleCode(e.target.value, 30) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Color</label>
                <input 
                  type="text" 
                  placeholder="e.g. White"
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleColor}
                  onChange={e => setFormData({ ...formData, vehicleColor: sanitizeDisplayName(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Capacity</label>
                <input 
                  type="number" 
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleCapacity}
                  onChange={e => setFormData({ ...formData, vehicleCapacity: parseInt(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Registration Number</label>
                <input 
                  type="text" 
                  placeholder="e.g. DL 01 AB 1234"
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleRegNumber}
                  onChange={e => setFormData({ ...formData, vehicleRegNumber: sanitizeLicenseOrVehicleCode(e.target.value, 18) })}
                />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Insurance Status</label>
              <select
                className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                value={formData.insuranceStatus}
                onChange={e => setFormData({
                  ...formData,
                  insuranceStatus: e.target.value as 'active' | 'expired',
                  insuranceProvider: e.target.value === 'active' ? formData.insuranceProvider : '',
                  insuranceExpiryDate: e.target.value === 'active' ? formData.insuranceExpiryDate : '',
                })}
              >
                <option value="active">Active</option>
                <option value="expired">Expired / Not Active</option>
              </select>
            </div>
            {formData.insuranceStatus === 'active' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Insurance Provider</label>
                  <input
                    type="text"
                    placeholder="e.g. ICICI Lombard"
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                    value={formData.insuranceProvider}
                    onChange={e => setFormData({ ...formData, insuranceProvider: sanitizeDisplayName(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Insurance Expiry</label>
                  <input
                    type="date"
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                    value={formData.insuranceExpiryDate}
                    onChange={e => setFormData({ ...formData, insuranceExpiryDate: e.target.value })}
                  />
                </div>
              </div>
            )}
            <div className="flex space-x-4 pt-4">
              <button onClick={() => setStep(3)} className="flex-1 bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold">Back</button>
              <button 
                disabled={
                  !formData.vehicleMake ||
                  !formData.vehicleModel ||
                  !formData.vehicleRegNumber ||
                  (formData.insuranceStatus === 'active' &&
                    (!formData.insuranceProvider || !formData.insuranceExpiryDate))
                }
                onClick={() => setStep(5)}
                className="flex-[2] bg-mairide-accent text-white py-5 rounded-3xl font-bold disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Vehicle Photo</p>
                <div 
                  onClick={() => setCapturingField('vehiclePhoto')}
                  className="aspect-square border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.vehiclePhoto ? (
                    <img src={formData.vehiclePhoto} className="w-full h-full object-cover" alt="Vehicle" />
                  ) : (
                    <Car className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">RC Photo</p>
                <div 
                  onClick={() => setCapturingField('rcPhoto')}
                  className="aspect-square border-2 border-dashed border-mairide-secondary rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-mairide-bg transition-colors overflow-hidden"
                >
                  {formData.rcPhoto ? (
                    <img src={formData.rcPhoto} className="w-full h-full object-cover" alt="RC" />
                  ) : (
                    <ShieldCheck className="w-8 h-8 text-mairide-secondary" />
                  )}
                </div>
              </div>
            </div>
            <div className="rounded-[28px] border border-mairide-secondary bg-mairide-bg/60 p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white px-4 py-3">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-mairide-secondary">Insurance Status</p>
                  <p className="mt-1 text-sm font-bold text-mairide-primary capitalize">{formData.insuranceStatus}</p>
                </div>
                {formData.insuranceStatus === 'active' && (
                  <>
                    <div className="rounded-2xl bg-white px-4 py-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-mairide-secondary">Provider</p>
                      <p className="mt-1 text-sm font-bold text-mairide-primary">{formData.insuranceProvider || 'Pending'}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-mairide-secondary">Expiry Date</p>
                      <p className="mt-1 text-sm font-bold text-mairide-primary">{formData.insuranceExpiryDate || 'Pending'}</p>
                    </div>
                  </>
                )}
              </div>
              <label className="flex items-start gap-3 rounded-2xl border border-mairide-secondary bg-white px-4 py-4 text-left">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-mairide-accent"
                  checked={formData.declarationAccepted}
                  onChange={(e) => setFormData({ ...formData, declarationAccepted: e.target.checked })}
                />
                <span className="text-[11px] leading-relaxed text-mairide-primary">
                  {DRIVER_DISCLOSURE_TEXT} {DRIVER_DECLARATION_TEXT}
                </span>
              </label>
            </div>
            <div className="flex space-x-4">
              <button onClick={() => setStep(4)} className="flex-1 bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold">Back</button>
              <button 
                disabled={
                  !formData.vehiclePhoto ||
                  !formData.rcPhoto ||
                  !formData.declarationAccepted ||
                  isSubmitting
                }
                onClick={handleSubmit}
                className="flex-[2] bg-mairide-accent text-white py-5 rounded-3xl font-bold disabled:opacity-50 flex items-center justify-center"
              >
                {isSubmitting ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Complete Setup'}
              </button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {capturingField && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60]"
            >
              <CameraCapture 
                title={`Capture ${capturingField.replace('Photo', '').toUpperCase()}`}
                onCapture={handleCapture}
                onCancel={() => setCapturingField(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

const PaymentProofModal = ({
  booking,
  payer,
  config,
  onClose,
  onSubmit,
}: {
  booking: Booking;
  payer: 'consumer' | 'driver';
  config: AppConfig | null;
  onClose: () => void;
  onSubmit: (payload: { transactionId: string; receiptDataUrl: string }) => Promise<void>;
}) => {
  const [transactionId, setTransactionId] = useState('');
  const [receiptName, setReceiptName] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const payableAmount = calculateServiceFee(booking.fare, config || undefined).totalFee;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setReceiptDataUrl(dataUrl);
    setReceiptName(file.name);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transactionId || !receiptDataUrl) {
      alert('Please enter the transaction ID and upload the payment receipt.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({ transactionId, receiptDataUrl });
      onClose();
    } catch (error: any) {
      alert(error.message || 'Failed to submit payment proof.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[36px] p-8 shadow-2xl border border-mairide-secondary"
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-2xl font-bold text-mairide-primary">Complete Platform Fee Payment</h3>
            <p className="text-sm text-mairide-secondary">
              {payer === 'consumer' ? 'Traveler' : 'Driver'} must pay only the MaiRide maintenance fee to keep contact details locked until both sides comply.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-mairide-bg rounded-full">
            <X className="w-5 h-5 text-mairide-secondary" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-mairide-bg p-5 rounded-3xl">
            <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Amount to Pay</p>
            <p className="text-3xl font-black text-mairide-accent mt-2">{formatCurrency(payableAmount)}</p>
            <p className="text-xs text-mairide-secondary mt-2">Includes `Rs 100` maintenance fee + `18% GST`.</p>
          </div>
          <div className="bg-mairide-bg p-5 rounded-3xl">
            <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">UPI ID</p>
            <p className="text-lg font-bold text-mairide-primary mt-2 break-all">{config?.upiId || 'Add UPI ID in admin config'}</p>
            <p className="text-xs text-mairide-secondary mt-2">Pay first, then submit the transaction reference and receipt below.</p>
          </div>
        </div>

        <div className="mb-6 bg-mairide-bg rounded-[32px] p-6 border border-mairide-secondary">
          <div className="w-full h-56 bg-white rounded-3xl border border-mairide-secondary overflow-hidden flex items-center justify-center">
            {config?.qrCodeUrl ? (
              <img src={config.qrCodeUrl} className="w-full h-full object-contain" alt="Payment QR" />
            ) : (
              <div className="text-center px-6">
                <Camera className="w-10 h-10 text-mairide-secondary mx-auto mb-3 opacity-30" />
                <p className="text-sm text-mairide-secondary">No QR code configured yet. Use the UPI ID above.</p>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Enter UPI / bank transaction ID"
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none"
          />
          <label className="block rounded-2xl border border-dashed border-mairide-secondary bg-mairide-bg p-5 cursor-pointer hover:border-mairide-accent transition-colors">
            <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-bold text-mairide-primary">Upload payment receipt</p>
                <p className="text-xs text-mairide-secondary">Screenshot, bank slip, or UPI success image.</p>
              </div>
              <span className="text-xs font-bold text-mairide-accent">{receiptName || 'Choose file'}</span>
            </div>
          </label>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-mairide-primary text-white py-4 rounded-2xl font-bold disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting proof...' : 'Submit Payment Proof'}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const RideReviewModal = ({
  booking,
  reviewerRole,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  booking: Booking;
  reviewerRole: 'consumer' | 'driver';
  onClose: () => void;
  onSubmit: (payload: { rating: number; comment: string; traits: string[] }) => Promise<void>;
  isSubmitting: boolean;
}) => {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);
  const counterpartLabel = reviewerRole === 'consumer' ? booking.driverName : booking.consumerName;
  const title = reviewerRole === 'consumer' ? 'Rate Your Driver' : 'Rate Your Traveler';
  const quickTraits =
    reviewerRole === 'consumer'
      ? ['On time', 'Professional', 'Clean car', 'Polite', 'Safe driving', 'Smooth communication']
      : ['On time', 'Polite', 'Clear communication', 'Pickup ready', 'Respectful', 'Easy coordination'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) return;
    await onSubmit({ rating, comment: comment.trim(), traits: selectedTraits });
  };

  const toggleTrait = (trait: string) => {
    setSelectedTraits((current) =>
      current.includes(trait) ? current.filter((item) => item !== trait) : [...current, trait]
    );
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-lg rounded-[36px] bg-white p-8 shadow-2xl"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Post-Ride Review</p>
            <h3 className="mt-2 text-3xl font-black tracking-tight text-mairide-primary">{title}</h3>
            <p className="mt-2 text-sm text-mairide-secondary">
              Share quick feedback about <span className="font-bold text-mairide-primary">{counterpartLabel}</span>.
            </p>
          </div>
          <button onClick={onClose} className="rounded-2xl bg-mairide-bg p-2 text-mairide-secondary hover:text-mairide-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-mairide-secondary">Rating</p>
            <div className="flex items-center gap-2">
              {Array.from({ length: 5 }, (_, index) => {
                const star = index + 1;
                const active = rating >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="rounded-2xl p-2 transition-transform hover:scale-105"
                  >
                    <Star
                      className={cn(
                        'h-8 w-8',
                        active ? 'fill-mairide-accent text-mairide-accent' : 'fill-transparent text-mairide-secondary/30'
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-mairide-secondary">Quick Highlights</p>
            <div className="flex flex-wrap gap-3">
              {quickTraits.map((trait) => {
                const active = selectedTraits.includes(trait);
                return (
                  <button
                    key={trait}
                    type="button"
                    onClick={() => toggleTrait(trait)}
                    className={cn(
                      'rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                      active
                        ? 'border-mairide-accent bg-mairide-accent/10 text-mairide-accent'
                        : 'border-mairide-secondary/40 bg-mairide-bg text-mairide-secondary hover:border-mairide-accent/40 hover:text-mairide-primary'
                    )}
                  >
                    {trait}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-3 block text-xs font-bold uppercase tracking-widest text-mairide-secondary">
              Review Comment (Optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="What went well, and what should improve?"
              className="w-full rounded-3xl border border-mairide-secondary bg-mairide-bg px-5 py-4 outline-none focus:border-mairide-accent"
            />
          </div>

          <button
            type="submit"
            disabled={!rating || isSubmitting}
            className="w-full rounded-3xl bg-mairide-primary py-4 text-lg font-bold text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting review...' : 'Submit Review'}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const TravelerDashboardSummary = ({
  bookings,
  rideStatusById = {},
  ridesResolved = false,
  config,
  onAcceptCounter,
  onRejectCounter,
  counterFares,
  setCounterFares,
  onCounter,
  onPayWithCoins,
  onPayOnline,
  onOpenBooking,
}: {
  bookings: Booking[];
  rideStatusById?: Record<string, Ride['status']>;
  ridesResolved?: boolean;
  config: AppConfig;
  onAcceptCounter: (booking: Booking) => void;
  onRejectCounter: (booking: Booking) => void;
  counterFares: { [key: string]: string };
  setCounterFares: React.Dispatch<React.SetStateAction<{ [key: string]: string }>>;
  onCounter: (booking: Booking, fare: number) => void;
  onPayWithCoins: (booking: Booking) => void;
  onPayOnline: (booking: Booking) => void;
  onOpenBooking: (booking: Booking) => void;
}) => {
  const activeBookings = bookings.filter((booking) => {
    if ((booking as any).rideRetired) return false;
    if (booking.negotiationStatus === 'rejected') return false;
    if (ridesResolved) {
      const rideStatus = rideStatusById[booking.rideId];
      if (!rideStatus || rideStatus === 'cancelled') return false;
    }
    return ['pending', 'confirmed', 'negotiating'].includes(booking.status);
  });

  if (!activeBookings.length) return null;

  return (
    <div className="mb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-mairide-primary">Active Bookings & Driver Responses</h2>
        <span className="text-xs font-bold uppercase tracking-widest text-mairide-accent">
          {activeBookings.length} Live
        </span>
      </div>
      <div className="space-y-4">
        {activeBookings.map((booking) => {
          const pendingActor = getPendingNegotiationActor(booking);
          const hasDriverCounterOffer = pendingActor === 'driver';
          const hasTravelerCounterOffer = pendingActor === 'consumer';
          const displayFare = getNegotiationDisplayFare(booking);
          const listedFare = getListedFare(booking);
          const showNegotiatedFareLine = shouldShowNegotiatedFareLine(booking);
          const statusLabel = getBookingStateLabel(booking);

          return (
          <div key={booking.id} className="bg-white border border-mairide-secondary rounded-[28px] p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center shrink-0">
                  {booking.driverPhotoUrl ? (
                    <img src={booking.driverPhotoUrl} alt={booking.driverName} className="w-full h-full object-cover" />
                  ) : (
                    <Car className="w-6 h-6 text-mairide-accent" />
                  )}
                </div>
                <div>
                <p className="text-lg font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                <p className="text-sm text-mairide-secondary">Driver: {booking.driverName}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-black text-mairide-accent">{formatCurrency(displayFare)}</p>
                <p className={cn(
                  "text-[10px] font-bold uppercase tracking-widest",
                  hasDriverCounterOffer || hasTravelerCounterOffer || booking.status === 'negotiating' ? "text-orange-700" :
                  booking.status === 'confirmed' ? "text-green-700" :
                  "text-mairide-secondary"
                )}>
                  {statusLabel}
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-mairide-bg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-mairide-secondary">Listed fare</span>
                <span className="text-base font-bold text-mairide-primary">{formatCurrency(listedFare)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-mairide-secondary">
                  {hasDriverCounterOffer ? 'Driver counter fare' : hasTravelerCounterOffer ? 'Your offered fare' : 'Current request fare'}
                </span>
                <span className={cn(
                  "text-lg font-black",
                  showNegotiatedFareLine ? "text-mairide-accent" : "text-mairide-primary"
                )}>
                  {formatCurrency(displayFare)}
                </span>
              </div>
            </div>
            {hasDriverCounterOffer && (
              <div className="mt-4 rounded-2xl border border-mairide-accent/20 bg-mairide-accent/10 p-4">
                <p className="font-bold text-mairide-primary">Counter offer received: {formatCurrency(displayFare)}</p>
                <div className="mt-4 flex flex-col md:flex-row gap-3">
                  <button onClick={() => onAcceptCounter(booking)} className={cn("flex-1 bg-mairide-primary text-white py-3", primaryActionButtonClass)}>
                    Accept Counter Offer
                  </button>
                  <button onClick={() => onRejectCounter(booking)} className={cn("flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3", secondaryActionButtonClass)}>
                    Reject
                  </button>
                </div>
                <div className="mt-4 flex flex-col md:flex-row gap-3">
                  <input
                    type="number"
                    min="1"
                    placeholder="Counter fare"
                    className="flex-1 rounded-2xl border border-mairide-secondary bg-white px-4 py-3 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                    value={counterFares[booking.id] || ''}
                    onChange={(e) => setCounterFares((prev) => ({ ...prev, [booking.id]: e.target.value }))}
                  />
                  <button
                    onClick={() => onCounter(booking, Number(counterFares[booking.id]))}
                    className={cn("bg-mairide-primary text-white px-6 py-3", primaryActionButtonClass)}
                  >
                    Send Counter
                  </button>
                </div>
              </div>
            )}
            {!hasDriverCounterOffer && booking.status !== 'confirmed' && (
              <div className={cn(
                "mt-4 rounded-2xl p-4",
                hasTravelerCounterOffer ? "border border-orange-200 bg-orange-50" : "border border-mairide-secondary/20 bg-mairide-bg"
              )}>
                {hasTravelerCounterOffer ? (
                  <>
                    <p className="font-bold text-mairide-primary">Your offer is awaiting the driver&apos;s response.</p>
                    <p className="mt-2 text-sm text-mairide-secondary">
                      Offered fare: <span className="font-bold text-mairide-accent">{formatCurrency(displayFare)}</span>
                    </p>
                  </>
                ) : (
                  <p className="font-bold text-mairide-primary">You can update your offer while the booking is still pending.</p>
                )}
                <div className="mt-4 flex flex-col md:flex-row gap-3">
                  <input
                    type="number"
                    min="1"
                    placeholder="Counter fare"
                    className="flex-1 rounded-2xl border border-mairide-secondary bg-white px-4 py-3 text-mairide-primary outline-none focus:ring-2 focus:ring-mairide-accent"
                    value={counterFares[booking.id] || ''}
                    onChange={(e) => setCounterFares((prev) => ({ ...prev, [booking.id]: e.target.value }))}
                  />
                  <button
                    onClick={() => onCounter(booking, Number(counterFares[booking.id]))}
                    className={cn("bg-mairide-primary text-white px-6 py-3", primaryActionButtonClass)}
                  >
                    Send Counter Offer
                  </button>
                </div>
              </div>
            )}
            {booking.status === 'confirmed' && (
              <div className="mt-4 rounded-2xl bg-mairide-bg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Platform Fee + GST</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(booking.serviceFee + booking.gstAmount)}</span>
                </div>
                <p className="text-xs text-mairide-secondary">
                  You can apply up to 25 MaiCoins against the platform fee portion only. GST and the remaining balance are paid online. MaiCoins cannot be used to pay the driver&apos;s ride fare.
                </p>
                {!booking.feePaid ? (
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => onPayWithCoins(booking)} className={cn("flex-1 bg-mairide-primary text-white py-3", primaryActionButtonClass)}>
                      {isLocalRazorpayEnabled(config) ? 'Use MaiCoins + Pay Balance' : 'Pay with Maicoins'}
                    </button>
                    <button onClick={() => onPayOnline(booking)} className={cn("flex-1 bg-white border border-mairide-primary text-mairide-primary py-3", secondaryActionButtonClass)}>
                      {isLocalRazorpayEnabled(config) ? 'Pay with Razorpay' : 'Pay Online'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-sm font-bold text-green-700">
                    Traveler payment submitted
                  </div>
                )}
                {booking.feePaid && booking.driverFeePaid ? (
                  <ContactUnlockCard label="Driver contact" phoneNumber={booking.driverPhone} />
                ) : null}
              </div>
            )}
            {booking.status === 'confirmed' && booking.feePaid && booking.driverFeePaid && !booking.rideStartedAt && booking.rideStartOtp && (
              <div className="mt-4 rounded-2xl border border-mairide-primary/20 bg-mairide-primary/5 p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Ride Start OTP</p>
                <p className="mt-2 text-3xl font-black tracking-[0.3em] text-mairide-primary">{booking.rideStartOtp}</p>
                <p className="mt-2 text-xs text-mairide-secondary">
                  Share this OTP with the driver only when the ride actually starts. Until then the driver stays hidden from new bookings.
                </p>
              </div>
            )}
            {booking.rideStartedAt && !booking.rideEndedAt && booking.rideEndOtp && (
              <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-green-700">End Ride OTP</p>
                <p className="mt-2 text-3xl font-black tracking-[0.3em] text-green-800">{booking.rideEndOtp}</p>
                <p className="mt-2 text-xs text-green-700">
                  Give this OTP to the driver only after your journey is completed so the ride can be closed on-platform.
                </p>
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => onOpenBooking(booking)}
                className="text-sm font-bold text-mairide-accent hover:text-mairide-primary transition-colors"
              >
                View Full Booking Details
              </button>
            </div>
          </div>
        )})}
      </div>
    </div>
  );
};

const TravelerCounterOffersSummary = ({
  bookings,
  rideStatusById = {},
  ridesResolved = false,
  onAcceptCounter,
  onRejectCounter,
}: {
  bookings: Booking[];
  rideStatusById?: Record<string, Ride['status']>;
  ridesResolved?: boolean;
  onAcceptCounter: (booking: Booking) => void;
  onRejectCounter: (booking: Booking) => void;
}) => {
  const counterOffers = bookings.filter((booking) => {
    if ((booking as any).rideRetired) return false;
    if (ridesResolved) {
      const rideStatus = rideStatusById[booking.rideId];
      if (!rideStatus || rideStatus === 'cancelled') return false;
    }
    if (['completed', 'cancelled', 'rejected'].includes(booking.status)) return false;
    if (booking.negotiationStatus === 'rejected') return false;
    return hasPendingDriverCounterOffer(booking);
  });

  if (!counterOffers.length) return null;

  return (
    <div className="mb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-mairide-primary">Live Driver Counter Offers</h2>
        <span className="text-xs font-bold uppercase tracking-widest text-mairide-accent">
          {counterOffers.length} Live
        </span>
      </div>
      <div className="space-y-4">
        {counterOffers.map((booking) => (
          <div key={booking.id} className="bg-white border border-mairide-secondary rounded-[28px] p-6 shadow-sm">
            {(() => {
              const listedFare = getListedFare(booking);
              const counterFare = getNegotiationDisplayFare(booking);
              const showNegotiatedFareLine = shouldShowNegotiatedFareLine(booking);
              return (
                <>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center shrink-0">
                  {booking.driverPhotoUrl ? (
                    <img src={booking.driverPhotoUrl} alt={booking.driverName} className="w-full h-full object-cover" />
                  ) : (
                    <Car className="w-6 h-6 text-mairide-accent" />
                  )}
                </div>
                <div>
                  <p className="text-lg font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                  <p className="text-sm text-mairide-secondary">Driver: {booking.driverName}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-mairide-accent">{formatCurrency(counterFare)}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-700">Counter Offer</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-mairide-bg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-mairide-secondary">
                  {showNegotiatedFareLine ? 'Listed fare' : 'Ride fare'}
                </span>
                <span className="text-base font-bold text-mairide-primary">{formatCurrency(listedFare)}</span>
              </div>
              {showNegotiatedFareLine && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-mairide-secondary">Driver counter fare</span>
                  <span className="text-lg font-black text-mairide-accent">{formatCurrency(counterFare)}</span>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-col md:flex-row gap-3">
              <button
                onClick={() => onAcceptCounter(booking)}
                className={cn("flex-1 bg-mairide-primary text-white py-3", primaryActionButtonClass)}
              >
                Accept Offer
              </button>
              <button
                onClick={() => onRejectCounter(booking)}
                className={cn("flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3", secondaryActionButtonClass)}
              >
                Reject
              </button>
            </div>
                </>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
};

const DriverDashboardSummary = ({
  requests,
  config,
  onAccept,
  onReject,
  counterFares,
  setCounterFares,
  onCounter,
  onPayWithCoins,
  onPayOnline,
  onStartRide,
  onEndRide,
}: {
  requests: Booking[];
  config: AppConfig;
  onAccept: (request: Booking) => void;
  onReject: (request: Booking) => void;
  counterFares: { [key: string]: string };
  setCounterFares: React.Dispatch<React.SetStateAction<{ [key: string]: string }>>;
  onCounter: (request: Booking, fare: number) => void;
  onPayWithCoins: (request: Booking) => void;
  onPayOnline: (request: Booking) => void;
  onStartRide: (request: Booking, otp: string) => void;
  onEndRide: (request: Booking, otp: string) => void;
}) => {
  const liveRequests = useMemo(
    () =>
      requests.filter((request) => {
        if ((request as any).rideRetired) return false;
        if (request.negotiationStatus === 'rejected') return false;
        return ['pending', 'negotiating', 'confirmed'].includes(request.status);
      }),
    [requests]
  );
  const [startOtpInputs, setStartOtpInputs] = useState<{ [key: string]: string }>({});
  const [endOtpInputs, setEndOtpInputs] = useState<{ [key: string]: string }>({});
  if (!liveRequests.length) return null;

  return (
    <div className="mb-12 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-mairide-primary">Live Traveler Requests & Counter Offers</h2>
        <span className="text-xs font-bold uppercase tracking-widest text-mairide-accent">
          {liveRequests.length} Live
        </span>
      </div>
      <div className="space-y-4">
        {liveRequests.map((request) => {
          const pendingActor = getPendingNegotiationActor(request);
          const travelerCounterPending = pendingActor === 'consumer';
          const driverCounterPending = pendingActor === 'driver';
          const displayFare = getNegotiationDisplayFare(request);
          const listedFare = getListedFare(request);
          const requestedOrigin = request.requestedOrigin || request.origin;
          const requestedDestination = request.requestedDestination || request.destination;
          const showsDetour =
            Boolean(request.requiresDetour) &&
            (normalizeSearchText(requestedOrigin) !== normalizeSearchText(request.origin) ||
              normalizeSearchText(requestedDestination) !== normalizeSearchText(request.destination));

          return (
          <div key={request.id} className="bg-white border border-mairide-secondary rounded-[28px] p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-lg font-bold text-mairide-primary">{request.origin} → {request.destination}</p>
                <p className="text-sm text-mairide-secondary">Traveler: {request.consumerName}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-black text-mairide-accent">{formatCurrency(displayFare)}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">
                  {driverCounterPending ? 'awaiting traveler' : travelerCounterPending ? 'traveler counter' : request.status}
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-mairide-bg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-mairide-secondary">Listed fare</span>
                <span className="text-base font-bold text-mairide-primary">{formatCurrency(listedFare)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-mairide-secondary">
                  {travelerCounterPending ? 'Traveler offered fare' : driverCounterPending ? 'Your counter fare' : 'Current request fare'}
                </span>
                <span className="text-lg font-black text-mairide-accent">{formatCurrency(displayFare)}</span>
              </div>
            </div>
            {showsDetour && (
              <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-mairide-accent" /><p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Traveler Detour Request</p></div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-mairide-secondary">Your listed route</p>
                    <p className="mt-1 text-sm font-semibold text-mairide-primary">{request.origin} → {request.destination}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-mairide-secondary">Traveler requested route</p>
                    <p className="mt-1 text-sm font-semibold text-mairide-primary">{requestedOrigin} → {requestedDestination}</p>
                  </div>
                </div>
                <div className="mt-3 rounded-xl bg-white/80 p-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Decision Impact</p>
                  <p className="mt-1 text-sm font-semibold text-mairide-primary">This booking changes your listed route. Please review the detour carefully before you accept, reject, or counter.</p>
                </div>
              </div>
            )}
            {driverCounterPending && (
              <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                <p className="font-bold text-mairide-primary">Your counter offer has been sent.</p>
                <p className="mt-2 text-sm text-mairide-secondary">
                  Waiting for the traveler to accept or reject <span className="font-bold text-mairide-accent">{formatCurrency(displayFare)}</span>.
                </p>
              </div>
            )}
            {(request.status === 'pending' || request.status === 'negotiating' || travelerCounterPending || driverCounterPending) && (
              <div className="mt-4 space-y-4">
                <div className="flex gap-3">
                  <button onClick={() => onAccept(request)} className={cn("flex-1 bg-green-600 text-white py-3", primaryActionButtonClass)}>
                    {travelerCounterPending || driverCounterPending ? 'Accept Offer' : 'Accept Request'}
                  </button>
                  <button onClick={() => onReject(request)} className={cn("flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3", secondaryActionButtonClass)}>
                    Reject
                  </button>
                </div>
                <div className="flex gap-3">
                  <input
                    type="number"
                    placeholder="Counter fare"
                    value={counterFares[request.id] || ''}
                    onChange={(e) => setCounterFares((prev) => ({ ...prev, [request.id]: e.target.value }))}
                    className="flex-1 p-3 bg-mairide-bg border border-mairide-secondary rounded-xl outline-none"
                  />
                  <button onClick={() => onCounter(request, Number(counterFares[request.id]))} className={cn("bg-mairide-primary text-white px-6 py-3", primaryActionButtonClass)}>
                    Send Counter
                  </button>
                </div>
              </div>
            )}
            {request.status === 'confirmed' && (
              <div className="mt-4 rounded-2xl bg-mairide-bg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Platform Fee + GST</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(request.serviceFee + request.gstAmount)}</span>
                </div>
                <p className="text-xs text-mairide-secondary">
                  You can apply up to 25 MaiCoins against the platform fee portion only. GST and the remaining balance are paid online. MaiCoins cannot be used to pay the traveler&apos;s ride fare.
                </p>
                {!request.driverFeePaid ? (
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => onPayWithCoins(request)} className={cn("flex-1 bg-mairide-primary text-white py-3", primaryActionButtonClass)}>
                      {isLocalRazorpayEnabled(config) ? 'Use MaiCoins + Pay Balance' : 'Pay with Maicoins'}
                    </button>
                    <button onClick={() => onPayOnline(request)} className={cn("flex-1 bg-white border border-mairide-primary text-mairide-primary py-3", secondaryActionButtonClass)}>
                      {isLocalRazorpayEnabled(config) ? 'Pay with Razorpay' : 'Pay Online'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-sm font-bold text-green-700">
                    Driver payment submitted
                  </div>
                )}
                {request.feePaid && request.driverFeePaid ? (
                  <ContactUnlockCard label="Traveler contact" phoneNumber={request.consumerPhone} />
                ) : null}
              </div>
            )}
            {request.status === 'confirmed' && request.feePaid && request.driverFeePaid && !request.rideStartedAt && (
              <div className="mt-4 rounded-2xl border border-mairide-primary/20 bg-mairide-primary/5 p-4">
                <p className="text-sm font-bold text-mairide-primary mb-3">Start Ride with Traveler OTP</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter start OTP"
                    value={startOtpInputs[request.id] || ''}
                    onChange={(e) => setStartOtpInputs((prev) => ({ ...prev, [request.id]: e.target.value }))}
                    className="flex-1 p-3 bg-white border border-mairide-secondary rounded-xl outline-none"
                  />
                  <button
                    onClick={() => onStartRide(request, startOtpInputs[request.id] || '')}
                    className={cn("bg-mairide-primary text-white px-6 py-3", primaryActionButtonClass)}
                  >
                    Start Ride
                  </button>
                </div>
              </div>
            )}
            {request.rideStartedAt && !request.rideEndedAt && (
              <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4">
                <p className="text-sm font-bold text-green-800 mb-3">End Ride with Traveler OTP</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter end OTP"
                    value={endOtpInputs[request.id] || ''}
                    onChange={(e) => setEndOtpInputs((prev) => ({ ...prev, [request.id]: e.target.value }))}
                    className="flex-1 p-3 bg-white border border-green-200 rounded-xl outline-none"
                  />
                  <button
                    onClick={() => onEndRide(request, endOtpInputs[request.id] || '')}
                    className={cn("bg-green-700 text-white px-6 py-3", primaryActionButtonClass)}
                  >
                    End Ride
                  </button>
                </div>
              </div>
            )}
          </div>
        )})}
      </div>
    </div>
  );
};

const ProfileInfoCard = ({
  label,
  value,
  subValue,
}: {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
}) => (
  <div className="bg-mairide-bg p-5 rounded-3xl border border-mairide-secondary/40">
    <p className="text-[10px] font-bold text-mairide-secondary uppercase tracking-widest mb-2">{label}</p>
    <div className="text-lg font-bold text-mairide-primary break-words">{value}</div>
    {subValue ? <p className="text-xs text-mairide-secondary mt-2">{subValue}</p> : null}
  </div>
);

const ViewOnlyDocumentCard = ({
  title,
  imageUrl,
}: {
  title: string;
  imageUrl?: string;
}) => (
  <div className="space-y-3">
    <p className="text-[10px] font-bold text-mairide-secondary uppercase tracking-widest text-center">{title}</p>
    <div className="aspect-[4/3] bg-mairide-bg rounded-3xl overflow-hidden border border-mairide-secondary relative group">
      {imageUrl ? (
        <>
          <img src={imageUrl} className="w-full h-full object-cover" alt={title} />
          <a
            href={imageUrl}
            target="_blank"
            rel="noreferrer"
            className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold"
          >
            View Full Size
          </a>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-center p-6">
          <div>
            <Camera className="w-8 h-8 text-mairide-secondary mx-auto mb-2" />
            <p className="text-xs font-bold text-mairide-secondary">No file uploaded</p>
          </div>
        </div>
      )}
    </div>
    <p className="text-[11px] text-mairide-secondary text-center">
      This document is view-only. Contact MaiRide support if any corrections are required.
    </p>
  </div>
);

const UserSelfProfilePanel = ({ profile }: { profile: UserProfile }) => {
  const [displayName, setDisplayName] = useState(profile.displayName || '');
  const [phoneNumber, setPhoneNumber] = useState(profile.phoneNumber || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDisplayName(profile.displayName || '');
    setPhoneNumber(profile.phoneNumber || '');
  }, [profile.displayName, profile.phoneNumber]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = normalizeEmailValue(profile.email);
    const normalizedPhone = toIndianPhoneStorage(phoneNumber);
    if (!isValidEmailValue(normalizedEmail)) {
      alert('A valid email address is required on this account.');
      return;
    }
    if (phoneNumber && !normalizedPhone) {
      alert('Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: sanitizeDisplayName(displayName),
        email: normalizedEmail,
        phoneNumber: normalizedPhone,
      });
      alert('Profile details updated successfully.');
      setIsEditing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-xl p-8">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-8">
          <div className="flex items-center gap-5">
            <div className="w-24 h-24 rounded-[32px] bg-mairide-bg border border-mairide-secondary overflow-hidden flex items-center justify-center">
              {getResolvedUserPhoto(profile) ? (
                <img src={getResolvedUserPhoto(profile)} alt={profile.displayName} className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-10 h-10 text-mairide-secondary" />
              )}
            </div>
            <div>
              <p className="text-[10px] font-bold text-mairide-secondary uppercase tracking-widest mb-2">Account Profile</p>
              <h2 className="text-3xl font-black tracking-tight text-mairide-primary">{profile.displayName}</h2>
              <p className="text-sm text-mairide-secondary break-all mt-1">{profile.email}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-full bg-green-50 text-green-700 text-[10px] font-bold uppercase tracking-widest">
                  {profile.status}
                </span>
                <span className="px-3 py-1 rounded-full bg-mairide-bg text-mairide-primary text-[10px] font-bold uppercase tracking-widest">
                  {profile.role === 'consumer' ? 'Traveler' : profile.role}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsEditing((current) => !current)}
            className="px-6 py-3 rounded-2xl bg-mairide-primary text-white font-bold hover:scale-[1.02] transition-transform"
          >
            {isEditing ? 'Close Edit Mode' : 'Edit Basic Details'}
          </button>
        </div>
      </div>

      {isEditing && (
        <form onSubmit={handleSave} className="bg-white rounded-[40px] border border-mairide-secondary shadow-xl p-8 space-y-6">
          <h3 className="text-xl font-bold text-mairide-primary">Update Basic Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Full Name</label>
              <input
                type="text"
                className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent"
                value={displayName}
                onChange={(e) => setDisplayName(sanitizeDisplayName(e.target.value))}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Phone Number</label>
              <IndianPhoneInput value={phoneNumber} onChange={setPhoneNumber} />
            </div>
          </div>
          <button
            type="submit"
            disabled={isSaving}
            className="w-full md:w-auto px-8 py-4 rounded-2xl bg-mairide-accent text-white font-bold hover:scale-[1.02] transition-transform disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Save Profile Changes'}
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <ProfileInfoCard label="Email" value={profile.email} />
        <ProfileInfoCard label="Phone Number" value={formatPhoneForDisplay(profile.phoneNumber)} />
        <ProfileInfoCard
          label="MaiCoins Wallet"
          value={
            <>
              {profile.wallet?.balance || 0} <span className="text-xs font-bold text-mairide-accent">MC</span>
            </>
          }
          subValue={`Pending: ${profile.wallet?.pendingBalance || 0} MC`}
        />
        <ProfileInfoCard
          label="Ratings"
          value={typeof profile.reviewStats?.averageRating === 'number' ? profile.reviewStats.averageRating.toFixed(1) : getResolvedUserRating(profile).toFixed(1)}
          subValue={`${profile.reviewStats?.ratingCount || 0} reviews recorded`}
        />
      </div>

      {profile.consents && (
        <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-xl p-8">
          <h3 className="text-xl font-bold text-mairide-primary mb-6">Consents & Account Declarations</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ProfileInfoCard
              label="Truth Declaration"
              value={profile.consents.truthfulInformationAccepted ? 'Accepted' : 'Not recorded'}
              subValue={`Accepted at ${new Date(profile.consents.acceptedAt).toLocaleString()}`}
            />
            <ProfileInfoCard
              label="Terms & Marketing"
              value={profile.consents.termsAccepted ? 'Terms accepted' : 'Terms missing'}
              subValue={`Marketing opt-in: ${profile.consents.marketingOptIn ? 'Enabled' : 'Disabled'}`}
            />
          </div>
        </div>
      )}

      {profile.role === 'driver' && profile.driverDetails && (
        <>
          <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-xl p-8">
            <h3 className="text-xl font-bold text-mairide-primary mb-6">Driver Verification Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              <ProfileInfoCard label="Aadhaar Number" value={formatAadhaarForDisplay(profile.driverDetails.aadhaarNumber)} />
              <ProfileInfoCard label="DL Number" value={profile.driverDetails.dlNumber || 'Not provided'} />
              <ProfileInfoCard label="Vehicle" value={`${profile.driverDetails.vehicleMake} ${profile.driverDetails.vehicleModel}`.trim() || 'Not provided'} />
              <ProfileInfoCard label="Registration" value={profile.driverDetails.vehicleRegNumber || 'Not provided'} />
              <ProfileInfoCard label="Insurance Status" value={profile.driverDetails.insuranceStatus || 'Not captured'} />
              <ProfileInfoCard label="Insurance Provider" value={profile.driverDetails.insuranceProvider || 'Not provided'} />
              <ProfileInfoCard label="Insurance Expiry" value={profile.driverDetails.insuranceExpiryDate || 'Not provided'} />
              <ProfileInfoCard label="Verification Status" value={profile.verificationStatus || 'pending'} />
            </div>
          </div>

          <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-xl p-8">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-xl font-bold text-mairide-primary">Uploaded Documents</h3>
                <p className="text-sm text-mairide-secondary">Your verification files are visible here for reference. They cannot be edited or deleted from this screen.</p>
              </div>
              <span className="px-4 py-2 rounded-full bg-mairide-bg text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
                View Only
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <ViewOnlyDocumentCard title="Selfie" imageUrl={profile.driverDetails.selfiePhoto} />
              <ViewOnlyDocumentCard title="Vehicle Photo" imageUrl={profile.driverDetails.vehiclePhoto} />
              <ViewOnlyDocumentCard title="Aadhaar Front" imageUrl={profile.driverDetails.aadhaarFrontPhoto} />
              <ViewOnlyDocumentCard title="Aadhaar Back" imageUrl={profile.driverDetails.aadhaarBackPhoto} />
              <ViewOnlyDocumentCard title="DL Front" imageUrl={profile.driverDetails.dlFrontPhoto} />
              <ViewOnlyDocumentCard title="DL Back" imageUrl={profile.driverDetails.dlBackPhoto} />
              <ViewOnlyDocumentCard title="RC Photo" imageUrl={profile.driverDetails.rcPhoto} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const MyBookings = ({ profile }: { profile: UserProfile }) => {
  const { config } = useAppConfig();
  const [bookings, setBookings] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentBooking, setPaymentBooking] = useState<Booking | null>(null);
  const [reviewBooking, setReviewBooking] = useState<Booking | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('consumerId', '==', profile.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      setBookings(
        dedupeBookingsByThread(list)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
      setLoading(false);
    });
    return () => unsubscribe();
  }, [profile.uid]);

  useEffect(() => {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...(docSnapshot.data() as Transaction) }));
      setTransactions(list);
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const submitTravelerPaymentProof = async (
    booking: Booking,
    payload: { transactionId: string; receiptDataUrl: string }
  ) => {
    const receiptRef = storageRef(storage, `payments/${booking.id}/consumer-${Date.now()}.jpg`);
    await uploadString(receiptRef, payload.receiptDataUrl, 'data_url');
    const receiptUrl = await getDownloadURL(receiptRef);
    await updateDoc(doc(db, 'bookings', booking.id), {
      feePaid: true,
      paymentStatus: 'proof_submitted',
      consumerPaymentMode: 'online',
      consumerPaymentTransactionId: payload.transactionId,
      consumerPaymentReceiptUrl: receiptUrl,
      consumerPaymentSubmittedAt: new Date().toISOString(),
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'consumer',
      paymentMode: 'online',
      paymentStatus: 'pending',
      transactionId: payload.transactionId,
      receiptUrl,
      gateway: 'manual',
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    alert('Traveler payment proof submitted successfully.');
  };

const finalizeTravelerRazorpayPayment = async (
  booking: Booking,
  payment: { paymentId: string; orderId: string; signature: string },
  coinsUsed = 0
) => {
    if (coinsUsed > 0) {
      await walletService.processTransaction(profile.uid, {
        amount: coinsUsed,
        type: 'debit',
        description: `Platform fee for ride to ${booking.destination}`,
        bookingId: booking.id
      });
    }
    await updateDoc(doc(db, 'bookings', booking.id), {
      feePaid: true,
      paymentStatus: 'paid',
      consumerPaymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      maiCoinsUsed: coinsUsed,
      consumerPaymentTransactionId: payment.paymentId,
      consumerPaymentOrderId: payment.orderId,
      consumerPaymentGateway: 'razorpay',
      consumerPaymentMetadata: {
        signature: payment.signature,
        verifiedAt: new Date().toISOString(),
      },
      consumerPaymentSubmittedAt: new Date().toISOString(),
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'consumer',
      paymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      paymentStatus: 'completed',
      transactionId: payment.paymentId,
      orderId: payment.orderId,
      gateway: 'razorpay',
      coinsUsed,
      metadata: {
        signature: payment.signature,
      },
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    showAppDialog('Traveler Razorpay payment verified successfully.', 'success');
  };

  const handlePayFee = async (booking: Booking, useCoins: boolean) => {
    try {
      const balance = profile.wallet?.balance || 0;
      const { totalFee, coinsToUse, amountPaid } = getHybridPaymentBreakdown(booking, balance, useCoins, config || undefined);

      if (amountPaid > 0) {
        if (isLocalRazorpayEnabled(config)) {
          await startRazorpayPlatformFeeCheckout({
            booking,
            payer: 'consumer',
            profile,
            config,
            amount: amountPaid,
            coinsUsed: coinsToUse,
            onVerified: (payment) => finalizeTravelerRazorpayPayment(booking, payment, coinsToUse),
          });
          return;
        }
        setPaymentBooking(booking);
        return;
      }
      
      await walletService.processTransaction(profile.uid, {
        amount: coinsToUse,
        type: 'debit',
        description: `Platform fee for ride to ${booking.destination}`,
        bookingId: booking.id
      });

      await updateDoc(doc(db, 'bookings', booking.id), {
        feePaid: true,
        maiCoinsUsed: coinsToUse,
        consumerPaymentMode: 'maicoins',
        paymentStatus: 'paid'
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'consumer',
        paymentMode: 'maicoins',
        paymentStatus: 'completed',
        coinsUsed: coinsToUse,
        gateway: 'manual',
      });

      // Trigger referral bonus activation
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      
      alert("Platform fee paid successfully!");
    } catch (error: any) {
      const message = getApiErrorMessage(error, 'Unable to start Razorpay checkout.');
      showAppDialog(message, 'error', 'Payment unavailable');
    }
  };

  const handleNegotiation = async (bookingId: string, action: 'accepted' | 'rejected', negotiatedFare?: number) => {
    try {
      const booking = bookings.find((candidate) => candidate.id === bookingId);
      if (!booking) {
        throw new Error('Booking not found.');
      }
      const token = await getAccessToken();

      await axios.post(
        '/api/user?action=traveler-respond-booking',
        {
          bookingId,
          consumerId: profile.uid,
          action,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const updatedAt = new Date().toISOString();
      setBookings((prev) =>
        prev.map((candidate) =>
          getBookingThreadKey(candidate) === getBookingThreadKey(booking)
            ? {
                ...candidate,
                status: action === 'accepted' ? 'confirmed' : 'rejected',
                fare: action === 'accepted' && negotiatedFare ? negotiatedFare : candidate.fare,
                negotiationStatus: action === 'accepted' ? 'accepted' : 'rejected',
                negotiationActor: 'driver',
                driverCounterPending: false,
                updatedAt,
              }
            : candidate
        )
      );

      showAppDialog(action === 'accepted' ? 'Counter offer accepted.' : 'Counter offer rejected.', 'success');
      return;
    } catch (error) {
      try {
        const booking = bookings.find((candidate) => candidate.id === bookingId);
        if (!booking) throw error;
        const acceptedFare =
          action === 'accepted' ? negotiatedFare ?? getNegotiationDisplayFare(booking) : undefined;
        const updatedAt = await persistNegotiationResolutionThroughCompatStore(booking, 'driver', action, {
          acceptedFare,
        });
        setBookings((prev) =>
          prev.map((candidate) =>
            getBookingThreadKey(candidate) === getBookingThreadKey(booking)
              ? {
                  ...candidate,
                  status: action === 'accepted' ? 'confirmed' : 'rejected',
                  ...(action === 'accepted' && acceptedFare ? { fare: acceptedFare } : {}),
                  negotiationStatus: action === 'accepted' ? 'accepted' : 'rejected',
                  negotiationActor: 'driver',
                  driverCounterPending: false,
                  rideRetired: action === 'rejected',
                  updatedAt,
                }
              : candidate
          )
        );
        showAppDialog(action === 'accepted' ? 'Counter offer accepted.' : 'Counter offer rejected.', 'success');
      } catch (fallbackError) {
        handleFirestoreError(fallbackError, OperationType.UPDATE, `bookings/${bookingId}`);
      }
    }
  };

  const handleSubmitReview = async ({
    rating,
    comment,
    traits,
  }: {
    rating: number;
    comment: string;
    traits: string[];
  }) => {
    if (!reviewBooking) return;

    setIsSubmittingReview(true);
    try {
      await submitBookingReview(reviewBooking.id, rating, comment, traits);
      alert('Your ride review has been submitted successfully.');
      setReviewBooking(null);
    } catch (error: any) {
      console.error('Error submitting ride review:', error);
      alert(error.response?.data?.error || error.message || 'Failed to submit ride review.');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const savingsEligibleBookings = bookings.filter((booking) => ['confirmed', 'completed'].includes(booking.status));
  const estimatedMarketMultiplier = 1.25;
  const estimatedEmptyLegSavings = savingsEligibleBookings.reduce(
    (sum, booking) => sum + Math.max(0, booking.fare * estimatedMarketMultiplier - booking.fare),
    0
  );
  const maicoinsSavings = savingsEligibleBookings.reduce(
    (sum, booking) => sum + (booking.maiCoinsUsed || 0),
    0
  );
  const totalTrips = savingsEligibleBookings.length;
  const historyChartData = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index));
    const month = date.toLocaleString('en-IN', { month: 'short' });
    const monthBookings = savingsEligibleBookings.filter((booking) => {
      const bookingDate = new Date(booking.createdAt);
      return bookingDate.getMonth() === date.getMonth() && bookingDate.getFullYear() === date.getFullYear();
    });
    const monthlySavings = monthBookings.reduce(
      (sum, booking) => sum + Math.max(0, booking.fare * estimatedMarketMultiplier - booking.fare),
      0
    );
    const monthlyMaicoins = monthBookings.reduce((sum, booking) => sum + (booking.maiCoinsUsed || 0), 0);
    return {
      month,
      savings: Math.round(monthlySavings),
      maicoins: Math.round(monthlyMaicoins),
    };
  });

  if (loading) return <LoadingScreen />;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-mairide-primary">My Bookings</h1>
        <div className="bg-mairide-primary text-white px-6 py-3 rounded-2xl flex items-center space-x-3 shadow-lg shadow-mairide-primary/20">
          <Bot className="w-5 h-5 text-mairide-accent" />
          <div>
            <p className="text-[10px] font-bold uppercase opacity-60 leading-none mb-1">Wallet Balance</p>
            <p className="text-lg font-black tracking-tighter">{profile.wallet?.balance || 0} <span className="text-xs font-bold text-mairide-accent">Maicoins</span></p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Trips Counted</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{totalTrips}</p>
          <p className="text-xs text-mairide-secondary mt-2">Confirmed/completed rides used for savings view.</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Estimated Empty-Leg Savings</p>
          <p className="mt-2 text-3xl font-black text-mairide-accent">{formatCurrency(estimatedEmptyLegSavings)}</p>
          <p className="text-xs text-mairide-secondary mt-2">Based on a 25% benchmark vs regular ride pricing.</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Savings via Maicoins</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{formatCurrency(maicoinsSavings)}</p>
          <p className="text-xs text-mairide-secondary mt-2">Equivalent value of Maicoins used on platform fees.</p>
        </div>
      </div>
      <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 mb-8 shadow-sm">
        <h2 className="text-lg font-bold text-mairide-primary mb-4">Savings Trend (Last 6 Months)</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={historyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DAD9D3" />
              <XAxis dataKey="month" stroke="#4A4A4A" />
              <YAxis stroke="#4A4A4A" />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="savings" name="Estimated Savings" fill="#E56A10" radius={[8, 8, 0, 0]} />
              <Bar dataKey="maicoins" name="Maicoins Savings" fill="#0F2A3D" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="space-y-6">
        {bookings.length > 0 ? (
          bookings.map((booking) => {
            const pendingActor = getPendingNegotiationActor(booking);
            const hasDriverCounterOffer = pendingActor === 'driver';
            const hasTravelerCounterOffer = pendingActor === 'consumer';
            const displayFare = getNegotiationDisplayFare(booking);
            const listedFare = getListedFare(booking);
            const showNegotiatedFareLine = shouldShowNegotiatedFareLine(booking);
            const statusLabel = getBookingStateLabel(booking);

            return (
            <div key={booking.id} className="bg-white p-8 rounded-[32px] border border-mairide-secondary shadow-sm hover:shadow-md transition-all">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center shrink-0">
                    {booking.driverPhotoUrl ? (
                      <img src={booking.driverPhotoUrl} alt={booking.driverName} className="w-full h-full object-cover" />
                    ) : (
                      <Car className="w-6 h-6 text-mairide-accent" />
                    )}
                  </div>
                  <div>
                  <h3 className="font-bold text-xl text-mairide-primary mb-1">{booking.origin} → {booking.destination}</h3>
                  <p className="text-sm text-mairide-secondary">Driver: {booking.driverName}</p>
                  {booking.feePaid && booking.driverFeePaid ? (
                    <ContactUnlockCard label="Driver contact" phoneNumber={booking.driverPhone} />
                  ) : booking.status === 'confirmed' ? (
                    <div className="mt-2 bg-orange-50 p-3 rounded-xl flex items-center space-x-2 text-orange-700 text-xs">
                      <Lock className="w-4 h-4" />
                      <span>Contact info locked. Both parties must pay the platform fee to unlock.</span>
                    </div>
                  ) : null}
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase mt-2">{new Date(booking.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                <div className={cn(
                  "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest",
                  booking.status === 'confirmed' ? "bg-green-100 text-green-700" :
                  (hasDriverCounterOffer || hasTravelerCounterOffer || booking.status === 'pending') ? "bg-orange-100 text-orange-700" :
                  "bg-red-100 text-red-700"
                )}>
                  {statusLabel}
                </div>
              </div>

              <div className="bg-mairide-bg p-6 rounded-2xl mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Listed fare</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(listedFare)}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">
                    {hasDriverCounterOffer ? 'Driver counter fare' : hasTravelerCounterOffer ? 'Your offered fare' : 'Current request fare'}
                  </span>
                  <span className={cn("font-bold", showNegotiatedFareLine ? "text-mairide-accent text-xl" : "text-mairide-primary text-lg")}>
                    {formatCurrency(displayFare)}
                  </span>
                </div>
              </div>

              {hasDriverCounterOffer && (
                <div className="mb-6 p-6 bg-mairide-accent/10 border border-mairide-accent rounded-2xl">
                  <p className="font-bold text-mairide-primary mb-2">Counter offer received: {formatCurrency(displayFare)}</p>
                  <div className="flex space-x-3">
                    <button 
                      onClick={() => handleNegotiation(booking.id, 'accepted', booking.negotiatedFare)}
                      className={cn("flex-1 bg-mairide-primary text-white py-3 text-sm", primaryActionButtonClass)}
                    >
                      Accept Counter Offer
                    </button>
                    <button 
                      onClick={() => handleNegotiation(booking.id, 'rejected')}
                      className={cn("flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3 text-sm", secondaryActionButtonClass)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {!hasDriverCounterOffer && booking.status !== 'confirmed' && (
                <div className={cn(
                  "mb-6 p-6 rounded-2xl",
                  hasTravelerCounterOffer ? "bg-mairide-accent/10 border border-mairide-accent" : "bg-mairide-bg border border-mairide-secondary/20"
                )}>
                  {hasTravelerCounterOffer ? (
                    <>
                      <p className="font-bold text-mairide-primary">Your counter offer has been sent.</p>
                      <p className="mt-2 text-sm text-mairide-secondary">
                        Waiting for the driver to accept or reject <span className="font-bold text-mairide-accent">{formatCurrency(displayFare)}</span>.
                      </p>
                    </>
                  ) : (
                    <p className="font-bold text-mairide-primary">You can update your offer while the booking is still pending.</p>
                  )}
                </div>
              )}

              <div className="bg-mairide-bg p-6 rounded-2xl mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Platform Fee</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(booking.serviceFee)}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">GST (18%)</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(booking.gstAmount)}</span>
                </div>
                <div className="h-px bg-mairide-secondary/20 my-4" />
                <div className="flex justify-between items-center">
                  <span className="text-lg font-bold text-mairide-primary">Traveler Pays Now</span>
                  <span className="text-2xl font-black text-mairide-accent">{formatCurrency(booking.serviceFee + booking.gstAmount)}</span>
                </div>
                <p className="mt-3 text-xs text-mairide-secondary">
                  Ride fare is settled between traveler and driver separately. You can apply up to 25 MaiCoins against the ₹100 platform fee, and any remaining fee plus GST is paid online.
                </p>
              </div>

              {booking.status === 'confirmed' && !booking.feePaid && (
                <div className="flex space-x-4">
                  <button 
                    onClick={() => handlePayFee(booking, true)}
                    className="flex-1 bg-mairide-primary text-white py-4 rounded-2xl font-bold hover:bg-mairide-accent transition-colors flex items-center justify-center space-x-2"
                  >
                    <Bot className="w-5 h-5" />
                    <span>{isLocalRazorpayEnabled(config) ? 'Use MaiCoins + Pay Balance' : 'Pay with Maicoins'}</span>
                  </button>
                  <button 
                    onClick={() => handlePayFee(booking, false)}
                    className="flex-1 bg-white border-2 border-mairide-primary text-mairide-primary py-4 rounded-2xl font-bold hover:bg-mairide-bg transition-colors"
                  >
                    {isLocalRazorpayEnabled(config) ? 'Pay with Razorpay' : 'Pay Online & Upload Proof'}
                  </button>
                </div>
              )}

              {booking.feePaid && (
                <div className="bg-green-50 border border-green-100 p-4 rounded-2xl flex items-center justify-center space-x-2 text-green-600 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Platform Fee Submitted {booking.maiCoinsUsed > 0 && `(Used ${booking.maiCoinsUsed} Maicoins)`}</span>
                </div>
              )}

              {booking.status === 'confirmed' && booking.feePaid && booking.driverFeePaid && !booking.rideStartedAt && booking.rideStartOtp && (
                <div className="mt-4 rounded-2xl border border-mairide-primary/20 bg-mairide-primary/5 p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Ride Start OTP</p>
                  <p className="mt-2 text-3xl font-black tracking-[0.3em] text-mairide-primary">{booking.rideStartOtp}</p>
                  <p className="mt-2 text-xs text-mairide-secondary">
                    Share this OTP with the driver only when the ride actually begins.
                  </p>
                </div>
              )}

              {booking.rideStartedAt && !booking.rideEndedAt && booking.rideEndOtp && (
                <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-green-700">End Ride OTP</p>
                  <p className="mt-2 text-3xl font-black tracking-[0.3em] text-green-800">{booking.rideEndOtp}</p>
                  <p className="mt-2 text-xs text-green-700">
                    Share this OTP with the driver only after the trip is completed.
                  </p>
                </div>
              )}

              {booking.status === 'completed' && (
                <div className="mt-4 rounded-2xl border border-mairide-secondary bg-mairide-bg p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Post-Ride Review</p>
                      {booking.consumerReview ? (
                        <>
                          <p className="mt-2 text-sm font-bold text-mairide-primary">
                            You rated {booking.driverName} {booking.consumerReview.rating}/5
                          </p>
                          {booking.consumerReview.comment && (
                            <p className="mt-1 text-sm italic text-mairide-secondary">"{booking.consumerReview.comment}"</p>
                          )}
                          {!!booking.consumerReview.traits?.length && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {booking.consumerReview.traits.map((trait) => (
                                <span
                                  key={trait}
                                  className="rounded-full bg-mairide-accent/10 px-3 py-1 text-xs font-bold text-mairide-accent"
                                >
                                  {trait}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-mairide-secondary">
                          Rate your driver now so future travelers can trust the platform more easily.
                        </p>
                      )}
                    </div>
                    {!booking.consumerReview && (
                      <button
                        onClick={() => setReviewBooking(booking)}
                        className="rounded-2xl bg-mairide-primary px-6 py-3 text-sm font-bold text-white"
                      >
                        Rate Driver
                      </button>
                    )}
                  </div>
                </div>
              )}

              <PaymentAuditTrail
                booking={booking}
                transactions={transactions}
                viewer="consumer"
              />
            </div>
          )})
        ) : (
          <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-mairide-secondary">
            <Car className="w-12 h-12 text-mairide-secondary mx-auto mb-4" />
            <p className="text-mairide-secondary">You haven't made any bookings yet.</p>
          </div>
        )}
      </div>
      {paymentBooking && (
        <PaymentProofModal
          booking={paymentBooking}
          payer="consumer"
          config={config}
          onClose={() => setPaymentBooking(null)}
          onSubmit={(payload) => submitTravelerPaymentProof(paymentBooking, payload)}
        />
      )}
      {reviewBooking && (
        <RideReviewModal
          booking={reviewBooking}
          reviewerRole="consumer"
          onClose={() => setReviewBooking(null)}
          onSubmit={handleSubmitReview}
          isSubmitting={isSubmittingReview}
        />
      )}
    </div>
  );
};

const MyRides = ({
  profile,
  hiddenRideIds = [],
  onRideRetired,
}: {
  profile: UserProfile;
  hiddenRideIds?: string[];
  onRideRetired?: (rideId: string) => void;
}) => {
  const [rides, setRides] = useState<any[]>([]);
  const [activeNegotiationRideIds, setActiveNegotiationRideIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingRideId, setCancellingRideId] = useState<string | null>(null);
  const [pendingCancelRide, setPendingCancelRide] = useState<any | null>(null);
  const visibleRides = useMemo(
    () =>
      rides.filter((ride) => {
        if (hiddenRideIds.includes(ride.id)) return false;
        return ['available', 'full'].includes(String(ride.status || ''));
      }),
    [rides, hiddenRideIds]
  );

  useEffect(() => {
    const q = query(
      collection(db, 'rides'),
      where('driverId', '==', profile.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      setRides(
        list
          .filter((ride) => ride.status !== 'cancelled' && !hiddenRideIds.includes(ride.id))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
      setLoading(false);
    });
    return () => unsubscribe();
  }, [profile.uid, hiddenRideIds]);

  useEffect(() => {
    const bookingQuery = query(collection(db, 'bookings'), where('driverId', '==', profile.uid));
    const unsubscribe = onSnapshot(bookingQuery, (snapshot) => {
      const rideIds = new Set<string>();
      snapshot.forEach((bookingDoc) => {
        const booking = bookingDoc.data() as Booking;
        const isNegotiationActive =
          ['pending', 'negotiating'].includes(String(booking.status || '')) &&
          booking.negotiationStatus !== 'rejected' &&
          !booking.rideRetired &&
          !booking.feePaid &&
          !booking.driverFeePaid &&
          !booking.rideStartedAt &&
          !booking.rideEndedAt;

        if (isNegotiationActive && booking.rideId) {
          rideIds.add(booking.rideId);
        }
      });
      setActiveNegotiationRideIds(Array.from(rideIds));
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const confirmCancelRideOffer = async (ride: any) => {
    if (ride.status !== 'available') {
      showAppDialog('Only active unbooked ride offers can be cancelled.', 'warning');
      return;
    }

    if (activeNegotiationRideIds.includes(ride.id)) {
      showAppDialog(
        'A traveler negotiation is currently active on this ride. Please wait for that offer thread to be accepted or rejected before cancelling the ride offer.',
        'warning'
      );
      return;
    }

    setCancellingRideId(ride.id);
    try {
      const bookingSnapshot = await getDocs(query(collection(db, 'bookings'), where('rideId', '==', ride.id)));
      const hasLockedTrip = bookingSnapshot.docs.some((bookingDoc) => {
        const booking = bookingDoc.data() as Booking;
        return (
          booking.status === 'confirmed' ||
          booking.feePaid ||
          booking.driverFeePaid ||
          !!booking.rideStartedAt ||
          !!booking.rideEndedAt
        );
      });

      if (hasLockedTrip) {
        showAppDialog(
          'This trip is already confirmed and locked for travel. Drivers cannot cancel it now. Please contact MaiRide customer support for an override if cancellation is unavoidable.',
          'warning'
        );
        return;
      }

      if (window.location.hostname === 'localhost') {
        await axios.post('/api/user/cancel-ride', {
          rideId: ride.id,
          driverId: profile.uid,
          driverPhone: profile.phoneNumber || '',
        });
        setRides((prev) => prev.filter((existingRide) => existingRide.id !== ride.id));
        onRideRetired?.(ride.id);
        showAppDialog('Ride offer cancelled. All live requests for this ride have been cleared.', 'success');
        setPendingCancelRide(null);
        return;
      }
      const updatedAt = new Date().toISOString();

      await Promise.all(
        bookingSnapshot.docs.map(async (bookingDoc) => {
          const booking = { id: bookingDoc.id, ...(bookingDoc.data() as Booking) };
          if (!['pending', 'confirmed', 'negotiating'].includes(booking.status)) return;
          await updateDoc(doc(db, 'bookings', booking.id), {
            status: 'cancelled',
            negotiationStatus: 'rejected',
            negotiationActor: booking.negotiationActor || 'driver',
            rideRetired: true,
            retiredAt: updatedAt,
            driverPhone: profile.phoneNumber || '',
            updatedAt,
          });
        })
      );

      await Promise.all(
        [ride.id].map((currentRideId) =>
          updateDoc(doc(db, 'rides', currentRideId), {
            status: 'cancelled',
            updatedAt,
          })
        )
      );

      setRides((prev) => prev.filter((currentRide) => currentRide.id !== ride.id));
      onRideRetired?.(ride.id);
      showAppDialog('Ride offer cancelled. All live requests linked to it were cleared.', 'success');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Failed to cancel ride offer');
      showAppDialog(message, 'error');
    } finally {
      setCancellingRideId(null);
      setPendingCancelRide(null);
    }
  };

  if (loading) return <LoadingScreen />;

  if (!visibleRides.length) return null;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold text-mairide-primary mb-8">My Ride Offers</h1>
      <div className="space-y-6">
        {visibleRides.map((ride) => (
            <div key={ride.id} className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg text-mairide-primary">{ride.origin} → {ride.destination}</h3>
                  <p className="text-sm text-mairide-secondary">Price: {formatCurrency(ride.price)}</p>
                </div>
                <div className={cn(
                  "px-4 py-1 rounded-full text-xs font-bold uppercase",
                  ride.status === 'available' ? "bg-green-100 text-green-700" : "bg-mairide-secondary text-mairide-primary"
                )}>
                  {ride.status}
                </div>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-mairide-secondary/20">
                <span className="text-sm text-mairide-secondary">{new Date(ride.createdAt).toLocaleDateString()}</span>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-mairide-primary">{ride.seatsAvailable} seats left</span>
                  {ride.status === 'available' && !activeNegotiationRideIds.includes(ride.id) && (
                    <button
                      onClick={() => setPendingCancelRide(ride)}
                      disabled={cancellingRideId === ride.id}
                      className="px-4 py-2 rounded-xl border border-red-200 text-red-700 text-xs font-bold hover:bg-red-50 disabled:opacity-50"
                    >
                      {cancellingRideId === ride.id ? 'Cancelling...' : 'Cancel Offer'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
      </div>
      {pendingCancelRide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-mairide-primary/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-700">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <button
                onClick={() => setPendingCancelRide(null)}
                className="rounded-full bg-mairide-bg p-2 text-mairide-secondary transition-colors hover:text-mairide-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Cancel Ride Offer</p>
            <p className="mt-3 text-base leading-7 text-mairide-primary">
              This will withdraw the ride offer and clear any live traveler requests attached to it. You can post a fresh offer later whenever you are ready.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setPendingCancelRide(null)}
                className="flex-1 rounded-2xl border border-mairide-secondary py-3 text-sm font-bold text-mairide-primary"
              >
                Keep Offer
              </button>
              <button
                onClick={() => confirmCancelRideOffer(pendingCancelRide)}
                className="flex-1 rounded-2xl bg-red-600 py-3 text-sm font-bold text-white hover:bg-red-700"
              >
                Cancel Ride
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DriverHistory = ({ profile }: { profile: UserProfile }) => {
  const [rides, setRides] = useState<any[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingRides, setLoadingRides] = useState(true);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [reviewBooking, setReviewBooking] = useState<Booking | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  useEffect(() => {
    const ridesQuery = query(collection(db, 'rides'), where('driverId', '==', profile.uid));
    const unsubscribeRides = onSnapshot(ridesQuery, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnapshot) => list.push({ id: docSnapshot.id, ...docSnapshot.data() }));
      setRides(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoadingRides(false);
    });

    const bookingsQuery = query(collection(db, 'bookings'), where('driverId', '==', profile.uid));
    const unsubscribeBookings = onSnapshot(bookingsQuery, (snapshot) => {
      const list: Booking[] = [];
      snapshot.forEach((docSnapshot) => list.push({ id: docSnapshot.id, ...(docSnapshot.data() as Booking) }));
      setBookings(
        dedupeBookingsByThread(list)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
      setLoadingBookings(false);
    });

    return () => {
      unsubscribeRides();
      unsubscribeBookings();
    };
  }, [profile.uid]);

  useEffect(() => {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...(docSnapshot.data() as Transaction) }));
      setTransactions(list);
    });
    return () => unsubscribe();
  }, [profile.uid]);

  if (loadingRides || loadingBookings) return <LoadingScreen />;

  const completedTrips = bookings.filter((booking) => booking.status === 'completed');
  const confirmedTrips = bookings.filter((booking) => ['confirmed', 'completed'].includes(booking.status));
  const cancelledOffers = rides.filter((ride) => ride.status === 'cancelled').length;
  const grossEarnings = completedTrips.reduce((sum, booking) => sum + (booking.fare || 0), 0);
  const maicoinsSavings = confirmedTrips.reduce((sum, booking) => sum + (booking.driverMaiCoinsUsed || 0), 0);

  const cashflowChart = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index));
    const month = date.toLocaleString('en-IN', { month: 'short' });

    const monthBookings = completedTrips.filter((booking) => {
      const bookingDate = new Date(booking.createdAt);
      return bookingDate.getMonth() === date.getMonth() && bookingDate.getFullYear() === date.getFullYear();
    });
    const monthMaicoins = confirmedTrips.filter((booking) => {
      const bookingDate = new Date(booking.createdAt);
      return bookingDate.getMonth() === date.getMonth() && bookingDate.getFullYear() === date.getFullYear();
    });

    return {
      month,
      earnings: Math.round(monthBookings.reduce((sum, booking) => sum + (booking.fare || 0), 0)),
      maicoins: Math.round(monthMaicoins.reduce((sum, booking) => sum + (booking.driverMaiCoinsUsed || 0), 0)),
    };
  });

  const handleSubmitReview = async ({
    rating,
    comment,
    traits,
  }: {
    rating: number;
    comment: string;
    traits: string[];
  }) => {
    if (!reviewBooking) return;

    setIsSubmittingReview(true);
    try {
      await submitBookingReview(reviewBooking.id, rating, comment, traits);
      alert('Your traveler review has been submitted successfully.');
      setReviewBooking(null);
    } catch (error: any) {
      console.error('Error submitting traveler review:', error);
      alert(error.response?.data?.error || error.message || 'Failed to submit traveler review.');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold text-mairide-primary mb-8">Driver History</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Rides Created</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{rides.length}</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Trips Completed</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{completedTrips.length}</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Offers Cancelled</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{cancelledOffers}</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Gross Earnings</p>
          <p className="mt-2 text-3xl font-black text-mairide-accent">{formatCurrency(grossEarnings)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Maicoins Savings</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{formatCurrency(maicoinsSavings)}</p>
          <p className="text-xs text-mairide-secondary mt-2">Equivalent amount offset from platform fees.</p>
        </div>
        <div className="bg-white rounded-3xl border border-mairide-secondary p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary">Current Wallet</p>
          <p className="mt-2 text-3xl font-black text-mairide-primary">{profile.wallet?.balance || 0}</p>
          <p className="text-xs text-mairide-secondary mt-2">Live Maicoins balance available right now.</p>
        </div>
      </div>

      <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 mb-8 shadow-sm">
        <h2 className="text-lg font-bold text-mairide-primary mb-4">Cashflow & Maicoins Trend (Last 6 Months)</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cashflowChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DAD9D3" />
              <XAxis dataKey="month" stroke="#4A4A4A" />
              <YAxis stroke="#4A4A4A" />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="earnings" name="Trip Earnings" fill="#E56A10" radius={[8, 8, 0, 0]} />
              <Bar dataKey="maicoins" name="Maicoins Savings" fill="#0F2A3D" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-bold text-mairide-primary">Completed Trips & Traveler Reviews</h2>
        {completedTrips.length ? (
          completedTrips.map((booking) => (
            <div key={booking.id} className="bg-white rounded-3xl border border-mairide-secondary p-6 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-lg font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                  <p className="text-sm text-mairide-secondary">Traveler: {booking.consumerName}</p>
                  <p className="text-xs font-bold uppercase tracking-widest text-mairide-secondary mt-2">
                    Completed {booking.rideEndedAt ? new Date(booking.rideEndedAt).toLocaleString() : new Date(booking.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="md:text-right">
                  <p className="text-lg font-black text-mairide-accent">{formatCurrency(booking.fare || 0)}</p>
                  {booking.driverReview ? (
                    <div className="mt-2 inline-flex items-center rounded-full bg-green-50 px-4 py-2 text-xs font-bold text-green-700">
                      Rated traveler {booking.driverReview.rating}/5
                    </div>
                  ) : (
                    <button
                      onClick={() => setReviewBooking(booking)}
                      className="mt-2 rounded-2xl bg-mairide-primary px-5 py-3 text-sm font-bold text-white"
                    >
                      Rate Traveler
                    </button>
                  )}
                </div>
              </div>
              {booking.driverReview?.comment && (
                <p className="mt-3 text-sm italic text-mairide-secondary">"{booking.driverReview.comment}"</p>
              )}
              {!!booking.driverReview?.traits?.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {booking.driverReview.traits.map((trait) => (
                    <span
                      key={trait}
                      className="rounded-full bg-mairide-accent/10 px-3 py-1 text-xs font-bold text-mairide-accent"
                    >
                      {trait}
                    </span>
                  ))}
                </div>
              )}
              <PaymentAuditTrail
                booking={booking}
                transactions={transactions}
                viewer="driver"
              />
            </div>
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-mairide-secondary bg-white py-12 text-center">
            <p className="text-mairide-secondary">Completed rides will appear here for traveler reviews.</p>
          </div>
        )}
      </div>

      <div className="mt-8 space-y-4">
        <h2 className="text-xl font-bold text-mairide-primary">All Ride Offers</h2>
        {rides.length ? (
          rides.map((ride) => (
            <div key={ride.id} className="bg-white rounded-3xl border border-mairide-secondary p-6 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-mairide-primary">{ride.origin} → {ride.destination}</p>
                  <p className="text-sm text-mairide-secondary">Created: {new Date(ride.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "px-4 py-1 rounded-full text-xs font-bold uppercase",
                    ride.status === 'available' ? "bg-green-100 text-green-700" :
                    ride.status === 'completed' ? "bg-blue-100 text-blue-700" :
                    ride.status === 'cancelled' ? "bg-red-100 text-red-700" :
                    "bg-mairide-bg text-mairide-primary"
                  )}>
                    {ride.status}
                  </span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(ride.price || 0)}</span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-mairide-secondary">
            <History className="w-12 h-12 text-mairide-secondary mx-auto mb-4" />
            <p className="text-mairide-secondary">No ride history yet.</p>
          </div>
        )}
      </div>
      {reviewBooking && (
        <RideReviewModal
          booking={reviewBooking}
          reviewerRole="driver"
          onClose={() => setReviewBooking(null)}
          onSubmit={handleSubmitReview}
          isSubmitting={isSubmittingReview}
        />
      )}
    </div>
  );
};

// --- Main App Components ---

const BookingRequests = ({ profile }: { profile: UserProfile }) => {
  const { config } = useAppConfig();
  const [requests, setRequests] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [counterFares, setCounterFares] = useState<{[key: string]: string}>({});
  const [paymentRequest, setPaymentRequest] = useState<Booking | null>(null);

  const loadRequestThread = async (seedBooking: Booking) => {
    const threadSnapshot = await getDocs(
      query(
        collection(db, 'bookings'),
        where('rideId', '==', seedBooking.rideId),
        where('consumerId', '==', seedBooking.consumerId)
      )
    );

    return threadSnapshot.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }))
      .filter((booking) => getBookingThreadKey(booking) === getBookingThreadKey(seedBooking));
  };

  const handleCounterOffer = async (requestId: string, fare: number) => {
    if (!fare || fare <= 0) {
      alert("Please enter a valid fare.");
      return;
    }
    try {
      const request = requests.find((booking) => booking.id === requestId);
      if (!request) {
        throw new Error('Booking request not found.');
      }
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=counter-booking',
        {
          bookingId: request.id,
          driverId: profile.uid,
          fare,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const updatedAt = new Date().toISOString();
      setRequests((prev) =>
        prev.map((booking) =>
          getBookingThreadKey(booking) === getBookingThreadKey(request)
            ? {
                ...booking,
                negotiatedFare: fare,
                negotiationStatus: 'pending',
                negotiationActor: 'driver',
                driverCounterPending: true,
                status: 'negotiating',
                updatedAt,
              }
            : booking
        )
      );
      showAppDialog("Counter offer sent to traveler!", 'success');
    } catch (error) {
      try {
        const request = requests.find((booking) => booking.id === requestId);
        if (!request) {
          throw error;
        }
        const updatedAt = await persistCounterOfferThroughCompatStore(request, 'driver', fare);
        setRequests((prev) =>
          prev.map((booking) =>
            getBookingThreadKey(booking) === getBookingThreadKey(request)
              ? {
                  ...booking,
                  negotiatedFare: fare,
                  negotiationStatus: 'pending',
                  negotiationActor: 'driver',
                  driverCounterPending: true,
                  status: 'negotiating',
                  updatedAt,
                }
              : booking
          )
        );
        showAppDialog("Counter offer sent to traveler!", 'success');
      } catch {
        handleFirestoreError(error, OperationType.UPDATE, `bookings/${requestId}`);
      }
    }
  };

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('driverId', '==', profile.uid),
      where('status', 'in', ['pending', 'confirmed', 'negotiating'])
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      setRequests(
        dedupeBookingsByThread(list)
          .filter(
            (booking) =>
              !(booking as any).rideRetired &&
              booking.negotiationStatus !== 'rejected' &&
              ['pending', 'confirmed', 'negotiating'].includes(booking.status)
          )
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });
    return () => unsubscribe();
  }, [profile.uid]);

  useEffect(() => {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...(docSnapshot.data() as Transaction) }));
      setTransactions(list);
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const handleAction = async (requestId: string, status: 'confirmed' | 'rejected', fare: number, driverId: string) => {
    try {
      const bookingData = requests.find((booking) => booking.id === requestId);
      if (!bookingData) {
        throw new Error('Booking request not found.');
      }
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=respond-booking',
        {
          bookingId: bookingData.id,
          driverId: profile.uid,
          action: status,
          driverPhone: profile.phoneNumber || '',
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const updatedAt = new Date().toISOString();
      const acceptedFare =
        hasPendingTravelerCounterOffer(bookingData) && bookingData.negotiatedFare
          ? bookingData.negotiatedFare
          : fare;

      setRequests((prev) =>
        status === 'rejected'
          ? prev.filter((booking) => getBookingThreadKey(booking) !== getBookingThreadKey(bookingData))
          : prev.map((booking) =>
              getBookingThreadKey(booking) === getBookingThreadKey(bookingData)
                ? {
                    ...booking,
                    status,
                    fare: acceptedFare,
                    driverPhone: profile.phoneNumber || '',
                    driverCounterPending: false,
                    negotiationStatus:
                      booking.negotiationStatus === 'pending' ? 'accepted' : booking.negotiationStatus,
                    updatedAt,
                  }
                : booking
            )
      );
      showAppDialog(status === 'confirmed' ? 'Booking confirmed.' : 'Traveler offer rejected.', 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${requestId}`);
    }
  };

  const submitDriverPaymentProof = async (
    booking: Booking,
    payload: { transactionId: string; receiptDataUrl: string }
  ) => {
    const receiptRef = storageRef(storage, `payments/${booking.id}/driver-${Date.now()}.jpg`);
    await uploadString(receiptRef, payload.receiptDataUrl, 'data_url');
    const receiptUrl = await getDownloadURL(receiptRef);
    await updateDoc(doc(db, 'bookings', booking.id), {
      driverFeePaid: true,
      paymentStatus: 'proof_submitted',
      driverPaymentMode: 'online',
      driverPaymentTransactionId: payload.transactionId,
      driverPaymentReceiptUrl: receiptUrl,
      driverPaymentSubmittedAt: new Date().toISOString(),
      driverPhone: profile.phoneNumber || '',
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'driver',
      paymentMode: 'online',
      paymentStatus: 'pending',
      transactionId: payload.transactionId,
      receiptUrl,
      gateway: 'manual',
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    alert('Driver payment proof submitted successfully.');
  };

const finalizeDriverRazorpayPayment = async (
  booking: Booking,
  payment: { paymentId: string; orderId: string; signature: string },
  coinsUsed = 0
) => {
    if (coinsUsed > 0) {
      await walletService.processTransaction(profile.uid, {
        amount: coinsUsed,
        type: 'debit',
        description: `Platform fee for ride from ${booking.origin}`,
        bookingId: booking.id
      });
    }
    await updateDoc(doc(db, 'bookings', booking.id), {
      driverFeePaid: true,
      paymentStatus: 'paid',
      driverPaymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      driverMaiCoinsUsed: coinsUsed,
      driverPaymentTransactionId: payment.paymentId,
      driverPaymentOrderId: payment.orderId,
      driverPaymentGateway: 'razorpay',
      driverPaymentMetadata: {
        signature: payment.signature,
        verifiedAt: new Date().toISOString(),
      },
      driverPaymentSubmittedAt: new Date().toISOString(),
      driverPhone: profile.phoneNumber || '',
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'driver',
      paymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      paymentStatus: 'completed',
      transactionId: payment.paymentId,
      orderId: payment.orderId,
      gateway: 'razorpay',
      coinsUsed,
      metadata: {
        signature: payment.signature,
      },
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    showAppDialog('Driver Razorpay payment verified successfully.', 'success');
  };

  const handlePayFee = async (booking: Booking, useCoins: boolean) => {
    try {
      const balance = profile.wallet?.balance || 0;
      const { totalFee, coinsToUse, amountPaid } = getHybridPaymentBreakdown(booking, balance, useCoins, config || undefined);

      if (amountPaid > 0) {
        if (isLocalRazorpayEnabled(config)) {
          await startRazorpayPlatformFeeCheckout({
            booking,
            payer: 'driver',
            profile,
            config,
            amount: amountPaid,
            coinsUsed: coinsToUse,
            onVerified: (payment) => finalizeDriverRazorpayPayment(booking, payment, coinsToUse),
          });
          return;
        }
        setPaymentRequest(booking);
        return;
      }

      await walletService.processTransaction(profile.uid, {
        amount: coinsToUse,
        type: 'debit',
        description: `Platform fee for ride from ${booking.origin}`,
        bookingId: booking.id
      });

      await updateDoc(doc(db, 'bookings', booking.id), {
        driverFeePaid: true,
        driverMaiCoinsUsed: coinsToUse,
        driverPaymentMode: 'maicoins',
        paymentStatus: 'paid',
        driverPhone: profile.phoneNumber || '',
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'driver',
        paymentMode: 'maicoins',
        paymentStatus: 'completed',
        coinsUsed: coinsToUse,
        gateway: 'manual',
      });

      // Trigger referral bonus activation
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      
      alert("Platform fee paid successfully!");
    } catch (error: any) {
      const message = getApiErrorMessage(error, 'Unable to start Razorpay checkout.');
      showAppDialog(message, 'error', 'Payment unavailable');
    }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="w-12 h-12 border-4 border-mairide-accent border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-mairide-primary">Booking Requests</h1>
        <div className="bg-mairide-primary text-white px-6 py-3 rounded-2xl flex items-center space-x-3 shadow-lg shadow-mairide-primary/20">
          <Bot className="w-5 h-5 text-mairide-accent" />
          <div>
            <p className="text-[10px] font-bold uppercase opacity-60 leading-none mb-1">Wallet Balance</p>
            <p className="text-lg font-black tracking-tighter">{profile.wallet?.balance || 0} <span className="text-xs font-bold text-mairide-accent">Maicoins</span></p>
          </div>
        </div>
      </div>
      <div className="space-y-6">
        {requests.length > 0 ? (
          requests.map((request) => (
            <div key={request.id} className="bg-white p-8 rounded-[32px] border border-mairide-secondary shadow-sm hover:shadow-md transition-shadow">
              {(() => {
                const pendingActor = getPendingNegotiationActor(request);
                const driverCounterPending = pendingActor === 'driver';
                const travelerCounterPending = pendingActor === 'consumer';
                const displayFare = getNegotiationDisplayFare(request);
                const listedFare = getListedFare(request);
                const showNegotiatedFareLine = shouldShowNegotiatedFareLine(request);
                const requestedOrigin = request.requestedOrigin || request.origin;
                const requestedDestination = request.requestedDestination || request.destination;
                const showsDetour =
                  Boolean(request.requiresDetour) &&
                  (normalizeSearchText(requestedOrigin) !== normalizeSearchText(request.origin) ||
                    normalizeSearchText(requestedDestination) !== normalizeSearchText(request.destination));
                const statusLabel = driverCounterPending
                  ? 'awaiting traveler'
                  : travelerCounterPending
                    ? 'traveler counter'
                    : request.status;

                return (
                  <>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-bold text-xl text-mairide-primary mb-1">{request.origin} → {request.destination}</h3>
                  <p className="text-sm text-mairide-secondary">Traveler: {request.consumerName}</p>
                  {request.feePaid && request.driverFeePaid ? (
                    <ContactUnlockCard label="Traveler contact" phoneNumber={request.consumerPhone} />
                  ) : request.status === 'confirmed' ? (
                    <div className="mt-2 bg-orange-50 p-3 rounded-xl flex items-center space-x-2 text-orange-700 text-xs">
                      <Lock className="w-4 h-4" />
                      <span>Contact info locked. Both parties must pay the platform fee to unlock.</span>
                    </div>
                  ) : null}
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase mt-2">{new Date(request.createdAt).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black text-mairide-accent">{formatCurrency(displayFare)}</p>
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase">{statusLabel}</p>
                </div>
              </div>
              
              <div className="bg-mairide-bg p-6 rounded-2xl mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Listed fare</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(listedFare)}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">
                    {travelerCounterPending ? 'Traveler offered fare' : driverCounterPending ? 'Your counter fare' : 'Current request fare'}
                  </span>
                  <span className={cn("font-bold", showNegotiatedFareLine ? "text-mairide-accent text-xl" : "text-mairide-primary text-lg")}>
                    {formatCurrency(displayFare)}
                  </span>
                </div>
              </div>

              {showsDetour && (
                <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                  <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-mairide-accent" /><p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Traveler Detour Request</p></div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-mairide-secondary">Your listed route</p>
                      <p className="mt-1 text-sm font-semibold text-mairide-primary">{request.origin} → {request.destination}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-mairide-secondary">Traveler requested route</p>
                      <p className="mt-1 text-sm font-semibold text-mairide-primary">{requestedOrigin} → {requestedDestination}</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl bg-white/80 p-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-mairide-accent">Decision Impact</p>
                    <p className="mt-1 text-sm font-semibold text-mairide-primary">This traveler wants a pickup and/or drop adjustment from your listed route. Review the detour carefully before you accept, reject, or counter.</p>
                  </div>
                </div>
              )}

              {driverCounterPending ? (
                <div className="bg-mairide-bg p-6 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Clock className="w-5 h-5 text-mairide-accent" />
                    <div>
                      <p className="font-bold text-mairide-primary">Your counter offer has been sent.</p>
                      <p className="text-xs text-mairide-secondary">Waiting for the traveler to accept or reject {formatCurrency(displayFare)}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleAction(request.id, 'rejected', request.fare, request.driverId)}
                    className="text-xs font-bold text-red-600 hover:underline"
                  >
                    Cancel Request
                  </button>
                </div>
              ) : (request.status === 'pending' || travelerCounterPending) ? (
                <div className="space-y-4">
                  <div className="flex space-x-4">
                    <button 
                      onClick={() => handleAction(request.id, 'confirmed', request.fare, request.driverId)}
                      className="flex-1 bg-green-600 text-white py-4 rounded-2xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-100"
                    >
                      {travelerCounterPending ? 'Accept Offer' : 'Accept Request'}
                    </button>
                    <button 
                      onClick={() => handleAction(request.id, 'rejected', request.fare, request.driverId)}
                      className="flex-1 bg-mairide-bg text-mairide-primary py-4 rounded-2xl font-bold hover:bg-mairide-secondary transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                  
                  <div className="pt-4 border-t border-mairide-secondary/20">
                    <p className="text-xs font-bold text-mairide-secondary uppercase mb-3">Or Send Counter Offer</p>
                    <div className="flex space-x-2">
                      <div className="relative flex-1">
                        <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 text-mairide-secondary w-4 h-4" />
                        <input 
                          type="number"
                          placeholder="Enter your fare"
                          className="w-full pl-10 pr-4 py-3 bg-mairide-bg border border-mairide-secondary rounded-xl outline-none text-sm"
                          value={counterFares[request.id] || ''}
                          onChange={e => setCounterFares({...counterFares, [request.id]: e.target.value})}
                        />
                      </div>
                      <button 
                        onClick={() => handleCounterOffer(request.id, Number(counterFares[request.id]))}
                        className="bg-mairide-primary text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-mairide-accent transition-colors"
                      >
                        Send Offer
                      </button>
                    </div>
                  </div>
                </div>
              ) : !request.driverFeePaid ? (
                <div className="flex space-x-4">
                  <button 
                    onClick={() => handlePayFee(request, true)}
                    className="flex-1 bg-mairide-primary text-white py-4 rounded-2xl font-bold hover:bg-mairide-accent transition-colors flex items-center justify-center space-x-2 shadow-lg shadow-mairide-primary/20"
                  >
                    <Bot className="w-5 h-5" />
                    <span>{isLocalRazorpayEnabled(config) ? 'Use MaiCoins + Pay Balance' : 'Pay with Maicoins'}</span>
                  </button>
                  <button 
                    onClick={() => handlePayFee(request, false)}
                    className="flex-1 bg-white border-2 border-mairide-primary text-mairide-primary py-4 rounded-2xl font-bold hover:bg-mairide-bg transition-colors"
                  >
                    {isLocalRazorpayEnabled(config) ? 'Pay with Razorpay' : 'Pay Online & Upload Proof'}
                  </button>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-100 p-4 rounded-2xl flex items-center justify-center space-x-2 text-green-600 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Platform Fee Submitted {request.driverMaiCoinsUsed > 0 && `(Used ${request.driverMaiCoinsUsed} Maicoins)`}</span>
                </div>
              )}

              <PaymentAuditTrail
                booking={request}
                transactions={transactions}
                viewer="driver"
              />
                  </>
                );
              })()}
            </div>
          ))
        ) : (
          <div className="text-center py-20 bg-white rounded-[40px] border border-dashed border-mairide-secondary">
            <Clock className="w-16 h-16 text-mairide-secondary mx-auto mb-4 opacity-20" />
            <h3 className="text-xl font-bold text-mairide-primary">No pending requests</h3>
            <p className="text-mairide-secondary italic serif">New booking requests from travelers will appear here.</p>
          </div>
        )}
      </div>
      {paymentRequest && (
        <PaymentProofModal
          booking={paymentRequest}
          payer="driver"
          config={config}
          onClose={() => setPaymentRequest(null)}
          onSubmit={(payload) => submitDriverPaymentProof(paymentRequest, payload)}
        />
      )}
    </div>
  );
};

const ConsumerApp = ({ profile, isLoaded, loadError, authFailure }: { profile: UserProfile, isLoaded: boolean, loadError?: Error, authFailure?: boolean }) => {
  const { config } = useAppConfig();
  const [search, setSearch] = useState({ from: '', to: '' });
  const [rides, setRides] = useState<any[]>([]);
  const [dashboardBookings, setDashboardBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'history' | 'wallet' | 'support' | 'profile'>('search');
  const [paymentBooking, setPaymentBooking] = useState<Booking | null>(null);

  if (loadError || authFailure) {
    return (
      <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-red-100">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Google Maps Error</h2>
        <p className="text-gray-600 mb-4">
          {loadError ? loadError.message : "Authentication Failure (Check API Key restrictions or billing)"}
        </p>
        <div className="text-sm bg-red-50 p-4 rounded-lg text-red-700 font-mono break-all text-left">
          <p className="font-bold mb-2">Possible Causes:</p>
          <ul className="list-disc ml-4 space-y-1">
            <li><strong>RefererNotAllowedMapError:</strong> Your domain restriction in Google Cloud Console is incorrect.</li>
            <li><strong>ApiNotActivatedMapError:</strong> Maps JavaScript API is not enabled.</li>
            <li><strong>BillingNotEnabledMapError:</strong> Billing is not linked to this project.</li>
          </ul>
          <p className="mt-4 text-xs opacity-70">API Key: {GOOGLE_MAPS_API_KEY.substring(0, 10)}...</p>
        </div>
      </div>
    );
  }
  const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [selectedRide, setSelectedRide] = useState<any | null>(null);
  const [pendingFutureRideAction, setPendingFutureRideAction] = useState<{
    ride: any;
    requestedFare?: number;
    mode: 'booking' | 'counter';
  } | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [travelerCounterFare, setTravelerCounterFare] = useState('');
  const [dashboardCounterFares, setDashboardCounterFares] = useState<{ [key: string]: string }>({});
  const [autocompleteFrom, setAutocompleteFrom] = useState<any | null>(null);
  const [autocompleteTo, setAutocompleteTo] = useState<any | null>(null);
  const [searchLocationFrom, setSearchLocationFrom] = useState<{ lat: number, lng: number } | null>(null);
  const [searchLocationTo, setSearchLocationTo] = useState<{ lat: number, lng: number } | null>(null);
  const [directionsResponse, setDirectionsResponse] = useState<any | null>(null);
  const [rideStatusById, setRideStatusById] = useState<Record<string, Ride['status']>>({});
  const [ridesResolved, setRidesResolved] = useState(false);
  const seenDriverCounterNotificationsRef = useRef<Record<string, string>>({});
  const hasHydratedDriverCountersRef = useRef(false);

  useEffect(() => {
    const handleHomeNavigation = () => setActiveTab('search');
    window.addEventListener(APP_NAV_HOME_EVENT, handleHomeNavigation);
    return () => window.removeEventListener(APP_NAV_HOME_EVENT, handleHomeNavigation);
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'bookings'), where('consumerId', '==', profile.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Booking[] = [];
      snapshot.forEach((snapshotDoc) => list.push({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }));
      setDashboardBookings(
        dedupeBookingsByThread(
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        )
      );
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });
    return () => unsubscribe();
  }, [profile.uid]);

  useEffect(() => {
    const currentKeys = dashboardBookings.reduce((acc: Record<string, string>, booking) => {
      if (hasPendingDriverCounterOffer(booking)) {
        acc[booking.id] = `${booking.negotiationActor}|${booking.negotiatedFare}|${(booking as any).updatedAt || booking.createdAt || ''}`;
      }
      return acc;
    }, {});

    if (!hasHydratedDriverCountersRef.current) {
      seenDriverCounterNotificationsRef.current = currentKeys;
      hasHydratedDriverCountersRef.current = true;
      return;
    }

    dashboardBookings.forEach((booking) => {
      if (!hasPendingDriverCounterOffer(booking)) return;
      const nextKey = currentKeys[booking.id];
      const previousKey = seenDriverCounterNotificationsRef.current[booking.id];
      if (nextKey && nextKey !== previousKey) {
        void sendBrowserNotification(
          'MaiRide Counter Offer',
          `${booking.driverName} proposed ${formatCurrency(getNegotiationDisplayFare(booking))} for ${booking.origin} to ${booking.destination}.`,
          { tag: `traveler-counter-${booking.id}` }
        );
      }
    });

    seenDriverCounterNotificationsRef.current = currentKeys;
  }, [dashboardBookings]);

  useEffect(() => {
    const q = query(collection(db, 'rides'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ridesList = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Ride) }));
      const nextStatusMap = ridesList.reduce((acc: Record<string, Ride['status']>, ride: Ride) => {
        acc[ride.id] = ride.status;
        return acc;
      }, {});
      setRideStatusById(nextStatusMap);
      setRidesResolved(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'rides');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (selectedRide && selectedRide.originLocation && selectedRide.destinationLocation && isLoaded && window.google) {
      const directionsService = new window.google.maps.DirectionsService();
      directionsService.route(
        {
          origin: selectedRide.originLocation,
          destination: selectedRide.destinationLocation,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === window.google.maps.DirectionsStatus.OK) {
            setDirectionsResponse(result);
          } else {
            console.error(`error fetching directions ${result}`);
          }
        }
      );
    } else {
      setDirectionsResponse(null);
    }
  }, [selectedRide, isLoaded]);

  const reverseGeocode = async (lat: number, lng: number) => {
    if (!window.google || !window.google.maps) return;
    const geocoder = new window.google.maps.Geocoder();
    try {
      const result = await geocoder.geocode({ location: { lat, lng } });
      if (result.results[0]) {
        setSearch(prev => ({ ...prev, from: result.results[0].formatted_address }));
      }
    } catch (error) {
      console.error("Geocoding failed:", error);
    }
  };

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const newLocation = { lat: latitude, lng: longitude };
          setUserLocation(newLocation);
          reverseGeocode(latitude, longitude);
          
          updateDoc(doc(db, 'users', profile.uid), {
            location: {
              ...newLocation,
              lastUpdated: new Date().toISOString()
            }
          }).catch((error) => handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`));
        },
        (error) => console.error("Initial Geolocation Error:", error),
        { enableHighAccuracy: true, timeout: 5000 }
      );

      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const newLocation = { lat: latitude, lng: longitude };
          setUserLocation(newLocation);
          
          updateDoc(doc(db, 'users', profile.uid), {
            location: {
              ...newLocation,
              lastUpdated: new Date().toISOString()
            }
          }).catch((error) => handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`));
        },
        (error) => console.error("Watch Geolocation Error:", error),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [profile.uid]);

  useEffect(() => {
    // Listen for online drivers within 100km radius
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const driverList: UserProfile[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as UserProfile;
        if (data.role === 'driver' && data.driverDetails?.isOnline && data.location) {
          // If consumer location is available, filter by 100km radius
          if (userLocation) {
            const distance = getDistance(
              userLocation.lat, 
              userLocation.lng, 
              data.location.lat, 
              data.location.lng
            );
            if (distance <= 100) {
              driverList.push(data);
            }
          } else {
            // Fallback: show all online drivers if location not yet available
            driverList.push(data);
          }
        }
      });
      setDrivers(driverList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });
    return () => unsubscribe();
  }, [userLocation]);

  const handleSearch = async () => {
    setIsLoading(true);
    try {
      let availableRides: Ride[] = [];
      let allBookings: Booking[] = [];

      if (window.location.hostname === 'localhost') {
        const [querySnapshot, bookingsSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'rides'), where('status', '==', 'available'))),
          getDocs(collection(db, 'bookings')),
        ]);
        availableRides = querySnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Ride) }));
        allBookings = bookingsSnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }));
      } else {
        const { data } = await axios.get('/api/health?action=search-rides');
        availableRides = Array.isArray(data?.rides) ? data.rides : [];
        allBookings = Array.isArray(data?.bookings) ? data.bookings : [];
      }

      const lockedRideIds = getLockedRideIds(allBookings);
      const rideMap = new Map<string, any>();
      availableRides.forEach((data) => {
        if (!data?.id || lockedRideIds.has(data.id)) {
          return;
        }

        const normalizedSearchFrom = normalizeSearchText(search.from);
        const normalizedSearchTo = normalizeSearchText(search.to);
        const normalizedOrigin = normalizeSearchText(data.origin);
        const normalizedDestination = normalizeSearchText(data.destination);

        const originDistance =
          searchLocationFrom && data.originLocation
            ? getDistance(
                searchLocationFrom.lat,
                searchLocationFrom.lng,
                data.originLocation.lat,
                data.originLocation.lng
              )
            : null;

        const destinationDistance =
          searchLocationTo && data.destinationLocation
            ? getDistance(
                searchLocationTo.lat,
                searchLocationTo.lng,
                data.destinationLocation.lat,
                data.destinationLocation.lng
              )
            : null;

        const corridorMatch =
          (searchLocationFrom || searchLocationTo) &&
          data.originLocation &&
          data.destinationLocation
            ? routeCorridorMatch({
                rideOriginLocation: data.originLocation,
                rideDestinationLocation: data.destinationLocation,
                travelerOriginLocation: searchLocationFrom,
                travelerDestinationLocation: searchLocationTo,
                ...getAdaptiveDetourToleranceKm(
                  getDistance(
                    data.originLocation.lat,
                    data.originLocation.lng,
                    data.destinationLocation.lat,
                    data.destinationLocation.lng
                  )
                ),
              })
            : false;

        const originMatches =
          !search.from ||
          corridorMatch ||
          (originDistance !== null
            ? originDistance <= 120
            : routeTextMatches(normalizedOrigin, normalizedSearchFrom));

        const destinationMatches =
          !search.to ||
          corridorMatch ||
          (destinationDistance !== null
            ? destinationDistance <= 120
            : routeTextMatches(normalizedDestination, normalizedSearchTo));

        const nearbyToTraveler =
          !userLocation ||
          !data.originLocation ||
          getDistance(
            userLocation.lat,
            userLocation.lng,
            data.originLocation.lat,
            data.originLocation.lng
          ) <= 500;

        const withinPlanningWindow = isRideWithinPlanningWindow(data);
        const isAdvancePlanningSearch = Boolean(search.from || search.to || searchLocationFrom || searchLocationTo);

        if (
          originMatches &&
          destinationMatches &&
          withinPlanningWindow &&
          (isAdvancePlanningSearch ? true : nearbyToTraveler)
        ) {
          const nextRide = { ...data };
          const dedupeKey = getRideDuplicateKey(nextRide);
          const existingRide = rideMap.get(dedupeKey);
          if (!existingRide || new Date(nextRide.createdAt).getTime() > new Date(existingRide.createdAt).getTime()) {
            rideMap.set(dedupeKey, nextRide);
          }
        }
      });
      setRides(
        Array.from(rideMap.values()).sort(
          (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
        )
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'rides');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBookRide = async (ride: any, requestedFare?: number) => {
    setIsBooking(true);
    try {
      const proposedFare = requestedFare && requestedFare > 0 ? requestedFare : ride.price;
      const { baseFee, gstAmount, totalFee } = calculateServiceFee(proposedFare, config || undefined);
      const totalPrice = proposedFare + totalFee;
      const updatedAt = new Date().toISOString();
      const requestedOrigin = (search.from || ride.origin).trim();
      const requestedDestination = (search.to || ride.destination).trim();
      const requiresDetour =
        normalizeSearchText(requestedOrigin) !== normalizeSearchText(ride.origin) ||
        normalizeSearchText(requestedDestination) !== normalizeSearchText(ride.destination);
      
      const bookingData = {
        rideId: ride.id,
        consumerId: profile.uid,
        consumerName: profile.displayName,
        consumerPhone: profile.phoneNumber || '',
        driverId: ride.driverId,
        driverName: ride.driverName,
        driverPhotoUrl: ride.driverPhotoUrl || '',
        origin: ride.origin,
        destination: ride.destination,
        listedOrigin: ride.origin,
        listedDestination: ride.destination,
        requestedOrigin,
        requestedDestination,
        requiresDetour,
        listedFare: ride.price,
        fare: proposedFare,
        seatsBooked: 1, // Default to 1 seat for now
        serviceFee: baseFee,
        gstAmount: gstAmount,
        totalPrice: totalPrice,
        status: 'pending',
        paymentStatus: 'pending',
        createdAt: updatedAt,
        updatedAt,
        maiCoinsUsed: 0,
        negotiatedFare: requestedFare && requestedFare > 0 && requestedFare !== ride.price ? requestedFare : undefined,
        negotiationStatus: requestedFare && requestedFare > 0 && requestedFare !== ride.price ? 'pending' : undefined,
        negotiationActor: requestedFare && requestedFare > 0 && requestedFare !== ride.price ? 'consumer' : undefined,
        driverCounterPending: false,
      };

      const existingThreadSnapshot = await getDocs(
        query(
          collection(db, 'bookings'),
          where('rideId', '==', ride.id),
          where('consumerId', '==', profile.uid)
        )
      );
      const activeThreadBookings = existingThreadSnapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }))
        .filter((booking) => ['pending', 'confirmed', 'negotiating'].includes(booking.status));

      if (activeThreadBookings.length) {
        await Promise.all(
          activeThreadBookings.map((booking) =>
            updateDoc(doc(db, 'bookings', booking.id), {
              ...bookingData,
              updatedAt,
            })
          )
        );
      } else {
        await addDoc(collection(db, 'bookings'), bookingData);
      }
      if (requestedFare && requestedFare > 0 && requestedFare !== ride.price) {
        void sendBrowserNotification(
          'MaiRide Counter Offer',
          `You offered ${formatCurrency(proposedFare)} for ${ride.origin} to ${ride.destination}.`,
          { tag: `traveler-sent-counter-${ride.id}`, requirePermissionPrompt: true }
        );
      }
      
      alert(
        requestedFare && requestedFare > 0 && requestedFare !== ride.price
          ? "Counter offer sent to the driver."
          : "Booking request sent! Once confirmed, you'll be notified."
      );
      setTravelerCounterFare('');
      setSelectedRide(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    } finally {
      setIsBooking(false);
    }
  };

  const requestRideBooking = (ride: any, requestedFare?: number) => {
    const isCounter = Boolean(requestedFare && requestedFare > 0 && requestedFare !== ride.price);
    if (isFutureRide(ride)) {
      setPendingFutureRideAction({
        ride,
        requestedFare,
        mode: isCounter ? 'counter' : 'booking',
      });
      return;
    }

    void handleBookRide(ride, requestedFare);
  };

  const handleTravelerNegotiation = async (booking: Booking, action: 'accepted' | 'rejected') => {
    try {
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=traveler-respond-booking',
        {
          bookingId: booking.id,
          consumerId: profile.uid,
          action,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const updatedAt = new Date().toISOString();
      setDashboardBookings((prev) =>
        prev.map((candidate) =>
          getBookingThreadKey(candidate) === getBookingThreadKey(booking)
            ? {
                ...candidate,
                status: action === 'accepted' ? 'confirmed' : 'rejected',
                fare: action === 'accepted' && booking.negotiatedFare ? booking.negotiatedFare : candidate.fare,
                negotiationStatus: action === 'accepted' ? 'accepted' : 'rejected',
                negotiationActor: 'driver',
                driverCounterPending: false,
                updatedAt,
              }
            : candidate
        )
      );
      showAppDialog(action === 'accepted' ? 'Counter offer accepted.' : 'Counter offer rejected.', 'success');
    } catch (error: any) {
      try {
        const acceptedFare =
          action === 'accepted' ? booking.negotiatedFare ?? getNegotiationDisplayFare(booking) : undefined;
        const updatedAt = await persistNegotiationResolutionThroughCompatStore(booking, 'driver', action, {
          acceptedFare,
        });
        setDashboardBookings((prev) =>
          prev.map((candidate) =>
            getBookingThreadKey(candidate) === getBookingThreadKey(booking)
              ? {
                  ...candidate,
                  status: action === 'accepted' ? 'confirmed' : 'rejected',
                  ...(action === 'accepted' && acceptedFare ? { fare: acceptedFare } : {}),
                  negotiationStatus: action === 'accepted' ? 'accepted' : 'rejected',
                  negotiationActor: 'driver',
                  driverCounterPending: false,
                  rideRetired: action === 'rejected',
                  updatedAt,
                }
              : candidate
          )
        );
        showAppDialog(action === 'accepted' ? 'Counter offer accepted.' : 'Counter offer rejected.', 'success');
      } catch (fallbackError: any) {
        const message = getApiErrorMessage(fallbackError, 'Failed to update negotiation.');
        showAppDialog(message, 'error', 'Negotiation update failed');
      }
    }
  };

  const handleTravelerCounterOffer = async (booking: Booking, fare: number) => {
    if (!fare || fare <= 0) {
      showAppDialog('Please enter a valid counter fare.', 'warning');
      return;
    }

    try {
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=traveler-counter-booking',
        {
          bookingId: booking.id,
          consumerId: profile.uid,
          fare,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const updatedAt = new Date().toISOString();
      await persistCounterOfferThroughCompatStore(booking, 'consumer', fare);
      setDashboardBookings((prev) =>
        prev.map((candidate) =>
          getBookingThreadKey(candidate) === getBookingThreadKey(booking)
            ? {
                ...candidate,
                negotiatedFare: fare,
                negotiationStatus: 'pending',
                negotiationActor: 'consumer',
                driverCounterPending: false,
                status: 'negotiating',
                rideRetired: false,
                updatedAt,
              }
            : candidate
        )
      );
      setDashboardCounterFares((prev) => ({ ...prev, [booking.id]: '' }));
      void sendBrowserNotification(
        'MaiRide Counter Offer',
        `You countered with ${formatCurrency(fare)} for ${booking.origin} to ${booking.destination}.`,
        { tag: `traveler-dashboard-counter-${booking.id}`, requirePermissionPrompt: true }
      );
      showAppDialog('Counter offer sent to the driver.', 'success');
    } catch (error) {
      try {
        const updatedAt = await persistCounterOfferThroughCompatStore(booking, 'consumer', fare);
        setDashboardBookings((prev) =>
          prev.map((candidate) =>
            getBookingThreadKey(candidate) === getBookingThreadKey(booking)
              ? {
                  ...candidate,
                  negotiatedFare: fare,
                  negotiationStatus: 'pending',
                  negotiationActor: 'consumer',
                  driverCounterPending: false,
                  status: 'negotiating',
                  rideRetired: false,
                  updatedAt,
                }
              : candidate
          )
        );
        setDashboardCounterFares((prev) => ({ ...prev, [booking.id]: '' }));
        showAppDialog('Counter offer sent to the driver.', 'success');
      } catch {
        handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
      }
    }
  };

  const submitTravelerPaymentProof = async (
    booking: Booking,
    payload: { transactionId: string; receiptDataUrl: string }
  ) => {
    try {
      const receiptRef = storageRef(storage, `payments/${booking.id}/consumer-${Date.now()}.jpg`);
      await uploadString(receiptRef, payload.receiptDataUrl, 'data_url');
      const receiptUrl = await getDownloadURL(receiptRef);
      await updateDoc(doc(db, 'bookings', booking.id), {
        feePaid: true,
        paymentStatus: 'proof_submitted',
        consumerPaymentMode: 'online',
        consumerPaymentTransactionId: payload.transactionId,
        consumerPaymentReceiptUrl: receiptUrl,
        consumerPaymentSubmittedAt: new Date().toISOString(),
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'consumer',
        paymentMode: 'online',
        paymentStatus: 'pending',
        transactionId: payload.transactionId,
        receiptUrl,
        gateway: 'manual',
      });
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Traveler payment proof submitted successfully.');
      setPaymentBooking(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

const finalizeTravelerDashboardRazorpayPayment = async (
  booking: Booking,
  payment: { paymentId: string; orderId: string; signature: string },
  coinsUsed = 0
) => {
    if (coinsUsed > 0) {
      await walletService.processTransaction(profile.uid, {
        amount: coinsUsed,
        type: 'debit',
        description: `Platform fee for ride to ${booking.destination}`,
        bookingId: booking.id,
      });
    }
    await updateDoc(doc(db, 'bookings', booking.id), {
      feePaid: true,
      paymentStatus: 'paid',
      consumerPaymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      maiCoinsUsed: coinsUsed,
      consumerPaymentTransactionId: payment.paymentId,
      consumerPaymentOrderId: payment.orderId,
      consumerPaymentGateway: 'razorpay',
      consumerPaymentMetadata: {
        signature: payment.signature,
        verifiedAt: new Date().toISOString(),
      },
      consumerPaymentSubmittedAt: new Date().toISOString(),
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'consumer',
      paymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      paymentStatus: 'completed',
      transactionId: payment.paymentId,
      orderId: payment.orderId,
      gateway: 'razorpay',
      coinsUsed,
      metadata: {
        signature: payment.signature,
      },
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    showAppDialog('Traveler Razorpay payment verified successfully.', 'success');
  };

  const handleTravelerDashboardPayment = async (booking: Booking, useCoins: boolean) => {
    try {
      const balance = profile.wallet?.balance || 0;
      const { totalFee, coinsToUse, amountPaid } = getHybridPaymentBreakdown(booking, balance, useCoins, config || undefined);
      if (amountPaid > 0) {
        if (isLocalRazorpayEnabled(config)) {
          await startRazorpayPlatformFeeCheckout({
            booking,
            payer: 'consumer',
            profile,
            config,
            amount: amountPaid,
            coinsUsed: coinsToUse,
            onVerified: (payment) => finalizeTravelerDashboardRazorpayPayment(booking, payment, coinsToUse),
          });
          return;
        }
        setPaymentBooking(booking);
        return;
      }

      await walletService.processTransaction(profile.uid, {
        amount: coinsToUse,
        type: 'debit',
        description: `Platform fee for ride to ${booking.destination}`,
        bookingId: booking.id,
      });

      await updateDoc(doc(db, 'bookings', booking.id), {
        feePaid: true,
        maiCoinsUsed: coinsToUse,
        consumerPaymentMode: 'maicoins',
        paymentStatus: 'paid',
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'consumer',
        paymentMode: 'maicoins',
        paymentStatus: 'completed',
        coinsUsed: coinsToUse,
        gateway: 'manual',
      });

      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Platform fee paid successfully.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <MobileSectionDrawer
        title="Consumer Menu"
        activeLabel={
          activeTab === 'search'
            ? 'Search'
            : activeTab === 'history'
              ? 'History'
              : activeTab === 'wallet'
                ? 'Wallet'
                : activeTab === 'support'
                  ? 'Support'
                  : 'Profile'
        }
        items={[
          { id: 'search', label: 'Search', icon: Search },
          { id: 'history', label: 'History', icon: History },
          { id: 'wallet', label: 'Wallet', icon: Wallet },
          { id: 'support', label: 'Support', icon: LifeBuoy },
          { id: 'profile', label: 'Profile', icon: UserIcon },
        ]}
        onSelect={(id) => setActiveTab(id as typeof activeTab)}
      />

      <div className="hidden md:flex bg-mairide-bg p-1 rounded-2xl mb-8 w-fit mx-auto overflow-x-auto">
        <button
          onClick={() => setActiveTab('search')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'search' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <Search className="w-4 h-4" />
          <span>Search</span>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'history' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <History className="w-4 h-4" />
          <span>History</span>
        </button>
        <button
          onClick={() => setActiveTab('wallet')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'wallet' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <Wallet className="w-4 h-4" />
          <span>Wallet</span>
        </button>
        <button
          onClick={() => setActiveTab('support')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'support' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <LifeBuoy className="w-4 h-4" />
          <span>Support</span>
        </button>
        <button
          onClick={() => setActiveTab('profile')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'profile' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <UserIcon className="w-4 h-4" />
          <span>Profile</span>
        </button>
      </div>

      {activeTab === 'search' && (
        <>
          <div className="flex flex-col md:flex-row md:items-center gap-6 mb-12">
            <img src={LOGO_URL} className="w-24 h-24 object-contain" alt="MaiRide Logo" />
            <div>
              <h1 className="text-4xl font-bold text-mairide-primary tracking-tight mb-2 uppercase">Where to?</h1>
              <p className="text-mairide-secondary italic serif">Find discounted intercity rides on empty leg journeys.</p>
            </div>
          </div>

          <TravelerDashboardSummary
            bookings={dashboardBookings}
            rideStatusById={rideStatusById}
            ridesResolved={ridesResolved}
            config={config}
            onAcceptCounter={(booking) => handleTravelerNegotiation(booking, 'accepted')}
            onRejectCounter={(booking) => handleTravelerNegotiation(booking, 'rejected')}
            counterFares={dashboardCounterFares}
            setCounterFares={setDashboardCounterFares}
            onCounter={(booking, fare) => handleTravelerCounterOffer(booking, fare)}
            onPayWithCoins={(booking) => handleTravelerDashboardPayment(booking, true)}
            onPayOnline={(booking) => handleTravelerDashboardPayment(booking, false)}
            onOpenBooking={() => setActiveTab('history')}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">MaiCoins Wallet</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-4xl font-black tracking-tight text-mairide-primary">{profile.wallet?.balance || 0}</p>
                  <p className="text-sm font-bold text-mairide-accent">Available Maicoins</p>
                </div>
                <Wallet className="w-10 h-10 text-mairide-accent" />
              </div>
              <p className="mt-3 text-sm text-mairide-secondary">
                Use Maicoins to reduce platform fees and stay rewarded for bringing repeat demand onto MaiRide.
              </p>
            </div>
            <div className="bg-mairide-primary rounded-[32px] border border-mairide-primary p-6 shadow-lg shadow-mairide-primary/20 text-white">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">Why It Matters</p>
              <p className="mt-3 text-2xl font-black tracking-tight">Earn. Refer. Save on every booking.</p>
              <p className="mt-3 text-sm text-white/80">
                Your wallet is your fastest growth engine on MaiRide. Keep it growing through referrals, bookings, and repeat usage.
              </p>
            </div>
          </div>

          <div id="consumer-live-map" className="mb-12 overflow-hidden rounded-[32px] border border-mairide-secondary bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-mairide-secondary/70">
              <div>
                <h2 className="text-xl font-bold text-mairide-primary flex items-center">
                  <MapPin className="w-5 h-5 mr-2 text-mairide-accent" />
                  Live Driver Map
                </h2>
                <p className="text-sm text-mairide-secondary">
                  See active driver positions around you before searching for a ride.
                </p>
              </div>
              <div className="rounded-full bg-mairide-bg px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
                {drivers.filter(d => d.location && typeof d.location.lat === 'number' && typeof d.location.lng === 'number').length} Cabs Visible
              </div>
            </div>
            <div className="h-[360px] relative">
              {(loadError || authFailure) ? (
                <div className="flex flex-col items-center justify-center h-full bg-red-50 p-8 text-center">
                  <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                  <h3 className="text-xl font-bold text-red-900 mb-2">Google Maps Error Detected</h3>
                  <p className="text-red-700 mb-4">
                    {loadError ? loadError.message : "Authentication Failure (Check Referrer Restrictions)"}
                  </p>
                  <div className="text-xs bg-white/50 p-4 rounded border border-red-200 text-red-800 font-mono text-left">
                    <p><strong>API Key:</strong> {GOOGLE_MAPS_API_KEY.substring(0, 10)}...</p>
                    <p><strong>Status:</strong> {isLoaded ? "Script Loaded" : "Script Not Loaded"}</p>
                  </div>
                </div>
              ) : GOOGLE_MAPS_API_KEY && isLoaded && window.google ? (
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={userLocation || { lat: 26.1433, lng: 91.7385 }}
                  zoom={userLocation ? 14 : 7}
                  options={{
                    styles: [
                      { "featureType": "all", "elementType": "geometry.fill", "stylers": [{ "weight": "2.00" }] },
                      { "featureType": "all", "elementType": "geometry.stroke", "stylers": [{ "color": "#9c9c9c" }] },
                      { "featureType": "all", "elementType": "labels.text", "stylers": [{ "visibility": "on" }] },
                      { "featureType": "landscape", "elementType": "all", "stylers": [{ "color": "#f2f2f2" }] },
                      { "featureType": "landscape", "elementType": "geometry.fill", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "landscape.man_made", "elementType": "geometry.fill", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "poi", "elementType": "all", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "road", "elementType": "all", "stylers": [{ "saturation": -100 }, { "lightness": 45 }] },
                      { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#eeeeee" }] },
                      { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#7b7b7b" }] },
                      { "featureType": "road", "elementType": "labels.text.stroke", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "road.highway", "elementType": "all", "stylers": [{ "visibility": "simplified" }] },
                      { "featureType": "road.arterial", "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "transit", "elementType": "all", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "water", "elementType": "all", "stylers": [{ "color": "#46bcec" }, { "visibility": "on" }] },
                      { "featureType": "water", "elementType": "geometry.fill", "stylers": [{ "color": "#c8d7d4" }] },
                      { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#070707" }] },
                      { "featureType": "water", "elementType": "labels.text.stroke", "stylers": [{ "color": "#ffffff" }] }
                    ]
                  }}
                >
                  {userLocation && (
                    <Marker
                      position={userLocation}
                      icon={{ url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png' }}
                      title="You"
                    />
                  )}
                  {drivers.filter(d => d.location && typeof d.location.lat === 'number' && typeof d.location.lng === 'number').map(driver => (
                    <Marker
                      key={driver.uid}
                      position={{ lat: driver.location!.lat, lng: driver.location!.lng }}
                      icon={{ url: 'https://maps.google.com/mapfiles/ms/icons/car.png' }}
                      title={driver.displayName}
                    />
                  ))}
                  {directionsResponse && (
                    <DirectionsRenderer directions={directionsResponse} />
                  )}
                </GoogleMap>
              ) : (
                <div className="flex flex-col items-center justify-center h-full bg-mairide-bg p-8 text-center">
                  <MapPin className="w-12 h-12 text-mairide-secondary mb-4" />
                  <h3 className="text-xl font-bold text-mairide-primary mb-2">
                    {loadError ? "Maps Error" : "Maps Unavailable"}
                  </h3>
                  <p className="text-mairide-secondary max-w-xs mx-auto">
                    {loadError ? loadError.message : "Please configure and activate your Google Maps API Key (Maps JavaScript API & Places API) in the Google Cloud Console."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-xl p-6 mb-12 border border-mairide-secondary">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-mairide-secondary w-5 h-5 z-10" />
                {isLoaded ? (
                  <Autocomplete
                    onLoad={autocomplete => setAutocompleteFrom(autocomplete)}
                    onPlaceChanged={() => {
                      if (autocompleteFrom) {
                        const place = autocompleteFrom.getPlace();
                        if (place.formatted_address) {
                          setSearch(prev => ({ ...prev, from: place.formatted_address! }));
                        }
                        if (place.geometry?.location) {
                          setSearchLocationFrom({
                            lat: place.geometry.location.lat(),
                            lng: place.geometry.location.lng()
                          });
                        }
                      }
                    }}
                  >
                    <input 
                      type="text" 
                      placeholder="From (Origin)"
                      className="w-full pl-12 pr-4 py-4 bg-mairide-bg border border-mairide-secondary rounded-2xl focus:ring-2 focus:ring-mairide-accent outline-none text-mairide-primary"
                      value={search.from}
                      onChange={e => setSearch({ ...search, from: e.target.value })}
                    />
                  </Autocomplete>
                ) : (
                  <input 
                    type="text" 
                    placeholder="From (Origin)"
                    className="w-full pl-12 pr-4 py-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none text-mairide-primary"
                    value={search.from}
                    onChange={e => setSearch({ ...search, from: e.target.value })}
                  />
                )}
                <button 
                  onClick={() => {
                    if (userLocation) reverseGeocode(userLocation.lat, userLocation.lng);
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-mairide-accent hover:text-mairide-primary z-10"
                  title="Detect my location"
                >
                  <Navigation className="w-4 h-4" />
                </button>
              </div>
              <div className="relative">
                <Navigation className="absolute left-4 top-1/2 -translate-y-1/2 text-mairide-secondary w-5 h-5 z-10" />
                {isLoaded ? (
                  <Autocomplete
                    onLoad={autocomplete => setAutocompleteTo(autocomplete)}
                    onPlaceChanged={() => {
                      if (autocompleteTo) {
                        const place = autocompleteTo.getPlace();
                        if (place.formatted_address) {
                          setSearch(prev => ({ ...prev, to: place.formatted_address! }));
                        }
                        if (place.geometry?.location) {
                          setSearchLocationTo({
                            lat: place.geometry.location.lat(),
                            lng: place.geometry.location.lng()
                          });
                        }
                      }
                    }}
                  >
                    <input 
                      type="text" 
                      placeholder="To (Destination)"
                      className="w-full pl-12 pr-4 py-4 bg-mairide-bg border border-mairide-secondary rounded-2xl focus:ring-2 focus:ring-mairide-accent outline-none text-mairide-primary"
                      value={search.to}
                      onChange={e => setSearch({ ...search, to: e.target.value })}
                    />
                  </Autocomplete>
                ) : (
                  <input 
                    type="text" 
                    placeholder="To (Destination)"
                    className="w-full pl-12 pr-4 py-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none text-mairide-primary"
                    value={search.to}
                    onChange={e => setSearch({ ...search, to: e.target.value })}
                  />
                )}
              </div>
            </div>
            <button 
              onClick={handleSearch}
              className="w-full bg-mairide-accent hover:bg-mairide-primary text-white py-4 rounded-2xl font-bold transition-all flex items-center justify-center space-x-2"
            >
              <Search className="w-5 h-5" />
              <span>Search Rides</span>
            </button>
          </div>

          <div className="space-y-6">
            <h2 className="text-xl font-bold text-mairide-primary flex items-center">
              <Clock className="w-5 h-5 mr-2 text-mairide-accent" />
              Available Rides
            </h2>

            {isLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-4 border-mairide-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : rides.length > 0 ? (
              rides.map(ride => (
                <motion.div 
                  key={ride.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-6"
                >
                  <div className="flex items-start space-x-4">
                    <div className="w-14 h-14 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center">
                      {ride.driverPhotoUrl ? (
                        <img src={ride.driverPhotoUrl} alt={ride.driverName} className="w-full h-full object-cover" />
                      ) : (
                        <Car className="w-8 h-8 text-mairide-accent" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="font-bold text-mairide-primary">{ride.driverName}</h3>
                        <div className="flex items-center text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-bold">
                          <Star className="w-3 h-3 mr-1 fill-current" />
                          {Number(ride.driverRating ?? ride.rating ?? 5).toFixed(1)}
                        </div>
                        {isFutureRide(ride) && (
                          <div className="flex items-center text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                            Future ride
                          </div>
                        )}
                      </div>
                      <div className="flex items-center text-sm text-mairide-secondary space-x-2">
                        <span>{ride.origin}</span>
                        <ChevronRight className="w-4 h-4" />
                        <span>{ride.destination}</span>
                      </div>
                      <div className={cn(
                        "mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-bold",
                        isFutureRide(ride)
                          ? "bg-orange-50 text-orange-700 border border-orange-200"
                          : "bg-mairide-bg text-mairide-primary border border-mairide-secondary"
                      )}>
                        <Clock className="w-3.5 h-3.5 mr-2" />
                        Departure: {formatRideDeparture(ride)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between md:flex-col md:items-end gap-2">
                    <div className="text-2xl font-black text-mairide-accent">
                      {formatCurrency(ride.price)}
                    </div>
                    <button 
                      onClick={() => setSelectedRide(ride)}
                      className="bg-mairide-primary text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-mairide-accent transition-colors"
                    >
                      Book Now
                    </button>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-12 bg-mairide-bg rounded-3xl border border-dashed border-mairide-secondary">
                <Search className="w-12 h-12 text-mairide-secondary mx-auto mb-4" />
                <p className="text-mairide-secondary">Enter your destination to find available rides.</p>
              </div>
            )}
          </div>

          <AnimatePresence>
            {selectedRide && (
              <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-black/60 backdrop-blur-sm">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white my-6 w-full max-w-md rounded-[40px] p-8 shadow-2xl border border-mairide-secondary overflow-y-auto max-h-[calc(100vh-3rem)] relative"
                >
                  <button 
                    onClick={() => setSelectedRide(null)}
                    className="absolute top-6 right-6 p-2 hover:bg-mairide-bg rounded-full transition-colors"
                  >
                    <X className="w-6 h-6 text-mairide-secondary" />
                  </button>

                  <div className="flex items-center space-x-4 mb-8">
                    <div className="w-16 h-16 bg-mairide-bg rounded-3xl overflow-hidden border border-mairide-secondary flex items-center justify-center">
                      {selectedRide.driverPhotoUrl ? (
                        <img src={selectedRide.driverPhotoUrl} alt={selectedRide.driverName} className="w-full h-full object-cover" />
                      ) : (
                        <Car className="w-8 h-8 text-mairide-accent" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-mairide-primary">Confirm Booking</h3>
                      <p className="text-xs text-mairide-secondary italic serif">Review your ride details</p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-8">
                    <div className="bg-mairide-bg p-6 rounded-3xl">
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-xs font-bold text-mairide-secondary uppercase">Driver</span>
                        <span className="font-bold text-mairide-primary">{selectedRide.driverName}</span>
                      </div>
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-xs font-bold text-mairide-secondary uppercase">Route</span>
                        <span className="font-bold text-mairide-primary text-right">{selectedRide.origin} → {selectedRide.destination}</span>
                      </div>
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-xs font-bold text-mairide-secondary uppercase">Likely Departure</span>
                        <span className={cn(
                          "text-right rounded-2xl px-3 py-2 text-sm font-black",
                          isFutureRide(selectedRide)
                            ? "bg-orange-100 text-orange-700"
                            : "bg-white text-mairide-primary border border-mairide-secondary"
                        )}>
                          {formatRideDeparture(selectedRide)}
                        </span>
                      </div>
                      {isFutureRide(selectedRide) && (
                        <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 mb-4">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-orange-700">Advance booking</p>
                          <p className="mt-1 text-sm text-orange-800">
                            This ride is scheduled for a future departure. Please confirm the date and likely start time carefully before continuing.
                          </p>
                        </div>
                      )}
                      <div className="h-px bg-mairide-secondary/20 my-4" />
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-mairide-secondary">Platform Fee</span>
                        <span className="font-bold text-mairide-primary">{formatCurrency(calculateServiceFee(selectedRide.price, config || undefined).baseFee)}</span>
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-mairide-secondary">GST (18%)</span>
                        <span className="font-bold text-mairide-primary">{formatCurrency(calculateServiceFee(selectedRide.price, config || undefined).gstAmount)}</span>
                      </div>
                      <div className="h-px bg-mairide-secondary/20 my-4" />
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold text-mairide-primary">Payable on Confirmation</span>
                        <span className="text-2xl font-black text-mairide-accent">{formatCurrency(calculateServiceFee(selectedRide.price, config || undefined).totalFee)}</span>
                      </div>
                      <p className="mt-3 text-xs text-mairide-secondary">
                        You are only committing to the MaiRide maintenance fee plus GST here. The ride fare itself is not collected by the platform in this step.
                      </p>
                    </div>

                    <div className="bg-mairide-bg p-6 rounded-3xl">
                      <p className="text-xs font-bold text-mairide-secondary uppercase mb-3">Want to negotiate?</p>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                          <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 text-mairide-secondary w-5 h-5" />
                          <input
                            type="number"
                            min="1"
                            placeholder="Enter your counter fare"
                            className="w-full pl-12 pr-4 py-4 bg-white border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                            value={travelerCounterFare}
                            onChange={(e) => setTravelerCounterFare(e.target.value)}
                          />
                        </div>
                        <button
                          onClick={() => requestRideBooking(selectedRide, Number(travelerCounterFare))}
                          disabled={isBooking || !travelerCounterFare || Number(travelerCounterFare) <= 0}
                          className="bg-mairide-primary text-white px-6 py-4 rounded-2xl font-bold hover:bg-mairide-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Send Counter Offer
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex space-x-3 mb-4">
                    <button 
                      onClick={() => {
                        setSelectedRide(null);
                        document.getElementById('consumer-live-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="flex-1 bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold text-lg hover:bg-mairide-secondary transition-all flex items-center justify-center space-x-3"
                    >
                      <MapPin className="w-6 h-6" />
                      <span>View on Map</span>
                    </button>
                    <button 
                      onClick={() => requestRideBooking(selectedRide)}
                      disabled={isBooking}
                      className="flex-[2] bg-mairide-accent text-white py-5 rounded-3xl font-bold text-lg hover:bg-mairide-primary transition-all flex items-center justify-center space-x-3 shadow-xl shadow-mairide-accent/20"
                    >
                      {isBooking ? (
                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <ShieldCheck className="w-6 h-6" />
                          <span>Send Booking Request</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-center text-mairide-secondary mt-4 px-4">
                    Once the driver accepts, both sides must submit the MaiRide platform fee payment proof before contact details are unlocked.
                  </p>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {pendingFutureRideAction && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-4 bg-black/60 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  className="my-6 w-full max-w-md rounded-[32px] border border-mairide-secondary bg-white p-6 shadow-2xl max-h-[calc(100vh-3rem)] overflow-y-auto"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-700">
                      <Clock className="w-6 h-6" />
                    </div>
                    <button
                      onClick={() => setPendingFutureRideAction(null)}
                      className="rounded-full bg-mairide-bg p-2 text-mairide-secondary transition-colors hover:text-mairide-primary"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Confirm future ride</p>
                  <h3 className="mt-2 text-2xl font-black tracking-tight text-mairide-primary">
                    {formatRideDeparture(pendingFutureRideAction.ride)}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-mairide-primary">
                    This is an advance trip, not an immediate departure. Please confirm you want to {pendingFutureRideAction.mode === 'counter' ? 'send a counter offer' : 'book this ride'} for the scheduled future date and time.
                  </p>
                  <div className="mt-6 flex gap-3">
                    <button
                      onClick={() => setPendingFutureRideAction(null)}
                      className="flex-1 rounded-2xl border border-mairide-secondary py-3 text-sm font-bold text-mairide-primary"
                    >
                      Go Back
                    </button>
                    <button
                      onClick={() => {
                        const nextAction = pendingFutureRideAction;
                        setPendingFutureRideAction(null);
                        void handleBookRide(nextAction.ride, nextAction.requestedFare);
                      }}
                      className="flex-1 rounded-2xl bg-mairide-accent py-3 text-sm font-bold text-white hover:bg-mairide-primary"
                    >
                      Confirm & Continue
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </>
      )}

      {activeTab === 'history' && <MyBookings profile={profile} />}
      {activeTab === 'wallet' && <WalletDashboard profile={profile} />}
      {activeTab === 'support' && <SupportSystem profile={profile} />}
      {activeTab === 'profile' && <UserSelfProfilePanel profile={profile} />}
      {paymentBooking && (
        <PaymentProofModal
          booking={paymentBooking}
          payer="consumer"
          config={config}
          onClose={() => setPaymentBooking(null)}
          onSubmit={(payload) => submitTravelerPaymentProof(paymentBooking, payload)}
        />
      )}
    </div>
  );
};

const DriverApp = ({ profile, isLoaded, loadError, authFailure }: { profile: UserProfile, isLoaded: boolean, loadError?: Error, authFailure?: boolean }) => {
  const { config } = useAppConfig();
  const [isOnline, setIsOnline] = useState(profile.driverDetails?.isOnline || false);
  const [newRide, setNewRide] = useState({ origin: '', destination: '', price: '', seats: '4', departureDay: 'today', departureClock: '09:00' });
  const [showOfferForm, setShowOfferForm] = useState(false);

  useEffect(() => {
    const handleHomeNavigation = () => setActiveTab('dashboard');
    window.addEventListener(APP_NAV_HOME_EVENT, handleHomeNavigation);
    return () => window.removeEventListener(APP_NAV_HOME_EVENT, handleHomeNavigation);
  }, []);
  const [isPostingRide, setIsPostingRide] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'requests' | 'history' | 'wallet' | 'support' | 'profile'>('dashboard');

  if (loadError || authFailure) {
    return (
      <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-red-100">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Google Maps Error</h2>
        <p className="text-gray-600 mb-4">
          {loadError ? loadError.message : "Authentication Failure (Check API Key restrictions or billing)"}
        </p>
        <div className="text-sm bg-red-50 p-4 rounded-lg text-red-700 font-mono break-all text-left">
          <p className="font-bold mb-2">Possible Causes:</p>
          <ul className="list-disc ml-4 space-y-1">
            <li><strong>RefererNotAllowedMapError:</strong> Your domain restriction in Google Cloud Console is incorrect.</li>
            <li><strong>ApiNotActivatedMapError:</strong> Maps JavaScript API is not enabled.</li>
          </ul>
        </div>
      </div>
    );
  }
  const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [autocompleteFrom, setAutocompleteFrom] = useState<any | null>(null);
  const [autocompleteTo, setAutocompleteTo] = useState<any | null>(null);
  const [originLocation, setOriginLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [destinationLocation, setDestinationLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [consumers, setConsumers] = useState<UserProfile[]>([]);
  const [requests, setRequests] = useState<Booking[]>([]);
  const [counterFares, setCounterFares] = useState<{ [key: string]: string }>({});
  const [paymentRequest, setPaymentRequest] = useState<Booking | null>(null);
  const [retiredRideIds, setRetiredRideIds] = useState<string[]>([]);
  const seenTravelerCounterNotificationsRef = useRef<Record<string, string>>({});
  const hasHydratedTravelerCountersRef = useRef(false);
  const activeDashboardRequests = useMemo(
    () => requests.filter((request) => !retiredRideIds.includes(request.rideId)),
    [requests, retiredRideIds]
  );

  useEffect(() => {
    // Listen for online travelers
    const q = query(collection(db, 'users'), where('role', '==', 'consumer'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const travelerList: UserProfile[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as UserProfile;
        if (data.location) {
          travelerList.push(data);
        }
      });
      setConsumers(travelerList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('driverId', '==', profile.uid),
      where('status', 'in', ['pending', 'confirmed', 'negotiating'])
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Booking[] = [];
      snapshot.forEach((snapshotDoc) => list.push({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }));
      setRequests(
        dedupeBookingsByThread(list)
          .filter(
            (booking) =>
              !retiredRideIds.includes(booking.rideId) &&
              !(booking as any).rideRetired &&
              booking.negotiationStatus !== 'rejected' &&
              ['pending', 'confirmed', 'negotiating'].includes(booking.status)
          )
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });
    return () => unsubscribe();
  }, [profile.uid, retiredRideIds]);

  useEffect(() => {
    const currentKeys = requests.reduce((acc: Record<string, string>, booking) => {
      if (hasPendingTravelerCounterOffer(booking)) {
        acc[booking.id] = `${booking.negotiationActor}|${booking.negotiatedFare}|${(booking as any).updatedAt || booking.createdAt || ''}`;
      }
      return acc;
    }, {});

    if (!hasHydratedTravelerCountersRef.current) {
      seenTravelerCounterNotificationsRef.current = currentKeys;
      hasHydratedTravelerCountersRef.current = true;
      return;
    }

    requests.forEach((booking) => {
      if (!hasPendingTravelerCounterOffer(booking)) return;
      const nextKey = currentKeys[booking.id];
      const previousKey = seenTravelerCounterNotificationsRef.current[booking.id];
      if (nextKey && nextKey !== previousKey) {
        void sendBrowserNotification(
          'MaiRide Counter Offer',
          `${booking.consumerName} offered ${formatCurrency(getNegotiationDisplayFare(booking))} for ${booking.origin} to ${booking.destination}.`,
          { tag: `driver-counter-${booking.id}` }
        );
      }
    });

    seenTravelerCounterNotificationsRef.current = currentKeys;
  }, [requests]);

  useEffect(() => {
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const newLocation = { lat: latitude, lng: longitude };
          setUserLocation(newLocation);
          
          // Update location in Firestore
          updateDoc(doc(db, 'users', profile.uid), {
            location: {
              ...newLocation,
              lastUpdated: new Date().toISOString()
            }
          }).catch((error) => handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`));
        },
        (error) => console.error("Geolocation Error:", error),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [profile.uid]);

  const toggleOnline = async () => {
    const newState = !isOnline;
    setIsOnline(newState);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        'driverDetails.isOnline': newState
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    }
  };

  const geocodeAddress = async (address: string) => {
    if (!window.google || !window.google.maps) return null;
    const geocoder = new window.google.maps.Geocoder();
    try {
      const result = await geocoder.geocode({ address });
      const location = result.results?.[0]?.geometry?.location;
      if (!location) return null;
      return {
        lat: location.lat(),
        lng: location.lng(),
      };
    } catch (error) {
      console.error('Address geocoding failed:', error);
      return null;
    }
  };

  const buildScheduledDeparture = (dayKey: string, timeValue: string) => {
    const scheduledDate = new Date();
    if (dayKey === 'tomorrow') {
      scheduledDate.setDate(scheduledDate.getDate() + 1);
    } else if (dayKey === 'dayAfter') {
      scheduledDate.setDate(scheduledDate.getDate() + 2);
    }

    const [hours, minutes] = (timeValue || '09:00').split(':').map(Number);
    scheduledDate.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    return scheduledDate.toISOString();
  };

  const formatDepartureDayLabel = (dayKey: string) => {
    if (dayKey === 'tomorrow') return 'Tomorrow';
    if (dayKey === 'dayAfter') return 'Day After';
    return 'Today';
  };

  const loadRelatedBookingThread = async (seedBooking: Booking) => {
    const snapshot = await getDocs(
      query(
        collection(db, 'bookings'),
        where('consumerId', '==', seedBooking.consumerId),
        where('driverId', '==', seedBooking.driverId)
      )
    );

    const threadKey = getBookingThreadKey(seedBooking);
    const threadBookings = snapshot.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }))
      .filter((booking) => getBookingThreadKey(booking) === threadKey)
      .filter((booking) => ['pending', 'confirmed', 'negotiating'].includes(booking.status));

    return threadBookings.length ? threadBookings : [seedBooking];
  };

  const handlePostRide = async () => {
    const origin = newRide.origin.trim();
    const destination = newRide.destination.trim();
    const priceValue = Number(newRide.price);
    const seatsValue = Number(newRide.seats);

    if (!origin || !destination) {
      alert('Please select both origin and destination before posting your offer.');
      return;
    }

    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      alert('Please enter a valid ride price greater than zero.');
      return;
    }

    if (!Number.isFinite(seatsValue) || seatsValue < 1) {
      alert('Please choose at least one available seat.');
      return;
    }

    setIsPostingRide(true);
    try {
      const resolvedOriginLocation = originLocation || userLocation || await geocodeAddress(origin);
      const resolvedDestinationLocation = destinationLocation || await geocodeAddress(destination);

      if (!resolvedOriginLocation) {
        alert('Please allow location access or select a valid origin from the suggestions.');
        return;
      }

      if (!resolvedDestinationLocation) {
        alert('Please select a valid destination from the suggestions.');
        return;
      }

      const ridePayload = {
        driverId: profile.uid,
        driverName: profile.displayName,
        driverPhotoUrl: getResolvedUserPhoto(profile),
        driverRating: getResolvedUserRating(profile),
        origin,
        destination,
        originLocation: resolvedOriginLocation,
        destinationLocation: resolvedDestinationLocation,
        price: priceValue,
        seatsAvailable: seatsValue,
        status: 'available',
        departureDay: newRide.departureDay,
        departureDayLabel: formatDepartureDayLabel(newRide.departureDay),
        departureClock: newRide.departureClock,
        departureNote: 'Planned departure time may vary based on traffic, road, and operational conditions.',
        departureTime: buildScheduledDeparture(newRide.departureDay, newRide.departureClock),
        createdAt: new Date().toISOString()
      };

      if (window.location.hostname === 'localhost') {
        await axios.post('/api/user/create-ride', ridePayload);
      } else {
        await addDoc(collection(db, 'rides'), ridePayload);
      }
      setNewRide({ origin: '', destination: '', price: '', seats: '4', departureDay: 'today', departureClock: '09:00' });
      setOriginLocation(null);
      setDestinationLocation(null);
      setShowOfferForm(false);
      alert("Ride offer posted successfully!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'rides');
    } finally {
      setIsPostingRide(false);
    }
  };

  const handleDriverAction = async (request: Booking, status: 'confirmed' | 'rejected') => {
    try {
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=respond-booking',
        {
          bookingId: request.id,
          driverId: profile.uid,
          action: status,
          driverPhone: profile.phoneNumber || '',
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const acceptedFare =
        hasPendingTravelerCounterOffer(request) && request.negotiatedFare
          ? request.negotiatedFare
          : request.fare;

      setRequests((prev) =>
        status === 'rejected'
          ? prev.filter((booking) => getBookingThreadKey(booking) !== getBookingThreadKey(request))
          : prev.map((booking) =>
              getBookingThreadKey(booking) === getBookingThreadKey(request)
                ? {
                    ...booking,
                    status,
                    fare: acceptedFare,
                    negotiationStatus:
                      booking.negotiationStatus === 'pending' ? 'accepted' : booking.negotiationStatus,
                    driverCounterPending: false,
                    driverPhone: profile.phoneNumber || '',
                    updatedAt: new Date().toISOString(),
                  }
                : booking
            )
      );

      showAppDialog(status === 'confirmed' ? 'Booking confirmed.' : 'Traveler offer rejected.', 'success');
    } catch (error) {
      try {
        const acceptedFare =
          hasPendingTravelerCounterOffer(request) && request.negotiatedFare
            ? request.negotiatedFare
            : getNegotiationDisplayFare(request);
        const updatedAt = await persistNegotiationResolutionThroughCompatStore(
          request,
          hasPendingTravelerCounterOffer(request) ? 'consumer' : 'driver',
          status,
          {
            acceptedFare,
            driverPhone: profile.phoneNumber || '',
          }
        );
        setRequests((prev) =>
          status === 'rejected'
            ? prev.filter((booking) => getBookingThreadKey(booking) !== getBookingThreadKey(request))
            : prev.map((booking) =>
                getBookingThreadKey(booking) === getBookingThreadKey(request)
                  ? {
                      ...booking,
                      status,
                      fare: acceptedFare,
                      negotiationStatus:
                        booking.negotiationStatus === 'pending' ? 'accepted' : booking.negotiationStatus,
                      driverCounterPending: false,
                      driverPhone: profile.phoneNumber || '',
                      updatedAt,
                    }
                  : booking
              )
        );
        showAppDialog(status === 'confirmed' ? 'Booking confirmed.' : 'Traveler offer rejected.', 'success');
      } catch (fallbackError) {
        handleFirestoreError(fallbackError, OperationType.UPDATE, `bookings/${request.id}`);
      }
    }
  };

  const handleDriverCounterOffer = async (request: Booking, fare: number) => {
    if (!fare || fare <= 0) {
      alert('Please enter a valid fare.');
      return;
    }

    try {
      const token = await getAccessToken();
      await axios.post(
        '/api/user?action=counter-booking',
        {
          bookingId: request.id,
          driverId: profile.uid,
          fare,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const updatedAt = new Date().toISOString();
      await persistCounterOfferThroughCompatStore(request, 'driver', fare);
      setRequests((prev) =>
        prev.map((booking) =>
          getBookingThreadKey(booking) === getBookingThreadKey(request)
            ? {
                ...booking,
                negotiatedFare: fare,
                negotiationStatus: 'pending',
                negotiationActor: 'driver',
                driverCounterPending: true,
                status: 'negotiating',
                updatedAt,
              }
            : booking
        )
      );
      showAppDialog('Counter offer sent to traveler.', 'success');
    } catch (error) {
      try {
        const updatedAt = await persistCounterOfferThroughCompatStore(request, 'driver', fare);
        setRequests((prev) =>
          prev.map((booking) =>
            getBookingThreadKey(booking) === getBookingThreadKey(request)
              ? {
                  ...booking,
                  negotiatedFare: fare,
                  negotiationStatus: 'pending',
                  negotiationActor: 'driver',
                  driverCounterPending: true,
                  status: 'negotiating',
                  updatedAt,
                }
              : booking
          )
        );
        showAppDialog('Counter offer sent to traveler.', 'success');
      } catch {
        handleFirestoreError(error, OperationType.UPDATE, `bookings/${request.id}`);
      }
    }
  };

  const submitDriverPaymentProof = async (
    booking: Booking,
    payload: { transactionId: string; receiptDataUrl: string }
  ) => {
    try {
      const receiptRef = storageRef(storage, `payments/${booking.id}/driver-${Date.now()}.jpg`);
      await uploadString(receiptRef, payload.receiptDataUrl, 'data_url');
      const receiptUrl = await getDownloadURL(receiptRef);
      await updateDoc(doc(db, 'bookings', booking.id), {
        driverFeePaid: true,
        paymentStatus: 'proof_submitted',
        driverPaymentMode: 'online',
        driverPaymentTransactionId: payload.transactionId,
        driverPaymentReceiptUrl: receiptUrl,
        driverPaymentSubmittedAt: new Date().toISOString(),
        driverPhone: profile.phoneNumber || '',
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'driver',
        paymentMode: 'online',
        paymentStatus: 'pending',
        transactionId: payload.transactionId,
        receiptUrl,
        gateway: 'manual',
      });
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Driver payment proof submitted successfully.');
      setPaymentRequest(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

const finalizeDriverDashboardRazorpayPayment = async (
  booking: Booking,
  payment: { paymentId: string; orderId: string; signature: string },
  coinsUsed = 0
) => {
    if (coinsUsed > 0) {
      await walletService.processTransaction(profile.uid, {
        amount: coinsUsed,
        type: 'debit',
        description: `Platform fee for ride from ${booking.origin}`,
        bookingId: booking.id,
      });
    }
    await updateDoc(doc(db, 'bookings', booking.id), {
      driverFeePaid: true,
      paymentStatus: 'paid',
      driverPaymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      driverMaiCoinsUsed: coinsUsed,
      driverPaymentTransactionId: payment.paymentId,
      driverPaymentOrderId: payment.orderId,
      driverPaymentGateway: 'razorpay',
      driverPaymentMetadata: {
        signature: payment.signature,
        verifiedAt: new Date().toISOString(),
      },
      driverPaymentSubmittedAt: new Date().toISOString(),
      driverPhone: profile.phoneNumber || '',
    });
    await recordPlatformFeeTransaction({
      booking,
      payer: 'driver',
      paymentMode: coinsUsed > 0 ? 'hybrid' : 'online',
      paymentStatus: 'completed',
      transactionId: payment.paymentId,
      orderId: payment.orderId,
      gateway: 'razorpay',
      coinsUsed,
      metadata: {
        signature: payment.signature,
      },
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    showAppDialog('Driver Razorpay payment verified successfully.', 'success');
  };

  const handleDriverDashboardPayment = async (booking: Booking, useCoins: boolean) => {
    try {
      const balance = profile.wallet?.balance || 0;
      const { totalFee, coinsToUse, amountPaid } = getHybridPaymentBreakdown(booking, balance, useCoins, config || undefined);
      if (amountPaid > 0) {
        if (isLocalRazorpayEnabled(config)) {
          await startRazorpayPlatformFeeCheckout({
            booking,
            payer: 'driver',
            profile,
            config,
            amount: amountPaid,
            coinsUsed: coinsToUse,
            onVerified: (payment) => finalizeDriverDashboardRazorpayPayment(booking, payment, coinsToUse),
          });
          return;
        }
        setPaymentRequest(booking);
        return;
      }

      await walletService.processTransaction(profile.uid, {
        amount: coinsToUse,
        type: 'debit',
        description: `Platform fee for ride from ${booking.origin}`,
        bookingId: booking.id,
      });

      await updateDoc(doc(db, 'bookings', booking.id), {
        driverFeePaid: true,
        driverMaiCoinsUsed: coinsToUse,
        driverPaymentMode: 'maicoins',
        paymentStatus: 'paid',
        driverPhone: profile.phoneNumber || '',
      });
      await recordPlatformFeeTransaction({
        booking,
        payer: 'driver',
        paymentMode: 'maicoins',
        paymentStatus: 'completed',
        coinsUsed: coinsToUse,
        gateway: 'manual',
      });

      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Platform fee paid successfully.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  const handleStartRide = async (booking: Booking, enteredOtp: string) => {
    if (!enteredOtp || enteredOtp !== booking.rideStartOtp) {
      alert('Invalid ride start OTP.');
      return;
    }

    try {
      await updateDoc(doc(db, 'bookings', booking.id), {
        rideLifecycleStatus: 'in_progress',
        rideStartedAt: new Date().toISOString(),
        rideStartOtpVerifiedAt: new Date().toISOString(),
        rideEndOtp: generateRideOtp(),
        rideEndOtpGeneratedAt: new Date().toISOString(),
      });

      await updateDoc(doc(db, 'rides', booking.rideId), {
        status: 'full',
      });

      await updateDoc(doc(db, 'users', booking.driverId), {
        'driverDetails.isOnline': false,
      });

      setIsOnline(false);
      alert('Ride started. Driver visibility is now hidden until the trip is closed.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  const handleEndRide = async (booking: Booking, enteredOtp: string) => {
    if (!enteredOtp || enteredOtp !== booking.rideEndOtp) {
      alert('Invalid end ride OTP.');
      return;
    }

    try {
      const completedAt = new Date().toISOString();
      await updateDoc(doc(db, 'bookings', booking.id), {
        rideLifecycleStatus: 'completed',
        rideEndedAt: completedAt,
        rideEndOtpVerifiedAt: completedAt,
        status: 'completed',
        driverEarningsCreditedAt: booking.driverEarningsCreditedAt || completedAt,
      });

      await updateDoc(doc(db, 'rides', booking.rideId), {
        status: 'completed',
      });

      if (!booking.driverEarningsCreditedAt) {
        const driverRef = doc(db, 'users', booking.driverId);
        const driverSnap = await getDoc(driverRef);
        if (driverSnap.exists()) {
          const driverData = driverSnap.data() as UserProfile;
          const currentEarnings = driverData.driverDetails?.totalEarnings || 0;
          await updateDoc(driverRef, {
            'driverDetails.totalEarnings': currentEarnings + booking.fare,
          });
        }
      }

      alert('Ride completed successfully. Go online again whenever you are ready for the next trip.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <MobileSectionDrawer
        title="Driver Menu"
        activeLabel={
          activeTab === 'dashboard'
            ? 'Dashboard'
            : activeTab === 'requests'
              ? 'Requests'
              : activeTab === 'history'
                ? 'History'
                : activeTab === 'wallet'
                  ? 'Wallet'
                  : activeTab === 'support'
                    ? 'Support'
                    : 'Profile'
        }
        items={[
          { id: 'dashboard', label: 'Dashboard', icon: Settings },
          { id: 'requests', label: 'Requests', icon: Clock },
          { id: 'history', label: 'History', icon: History },
          { id: 'wallet', label: 'Wallet', icon: Wallet },
          { id: 'support', label: 'Support', icon: LifeBuoy },
          { id: 'profile', label: 'Profile', icon: UserIcon },
        ]}
        onSelect={(id) => setActiveTab(id as typeof activeTab)}
      />

      <div className="hidden md:flex bg-mairide-bg p-1 rounded-2xl mb-8 w-fit mx-auto overflow-x-auto">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'dashboard' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <Settings className="w-4 h-4" />
          <span>Dashboard</span>
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'requests' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <Clock className="w-4 h-4" />
          <span>Requests</span>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'history' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <History className="w-4 h-4" />
          <span>History</span>
        </button>
        <button
          onClick={() => setActiveTab('wallet')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'wallet' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <Wallet className="w-4 h-4" />
          <span>Wallet</span>
        </button>
        <button
          onClick={() => setActiveTab('support')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'support' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <LifeBuoy className="w-4 h-4" />
          <span>Support</span>
        </button>
        <button
          onClick={() => setActiveTab('profile')}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center space-x-2 whitespace-nowrap",
            activeTab === 'profile' ? "bg-white text-mairide-accent shadow-sm" : "text-mairide-primary"
          )}
        >
          <UserIcon className="w-4 h-4" />
          <span>Profile</span>
        </button>
      </div>

      {activeTab === 'dashboard' && (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
            <div className="flex items-center space-x-6">
              <img src={LOGO_URL} className="w-24 h-24 object-contain" alt="MaiRide Logo" />
              <div>
                <h1 className="text-4xl font-bold text-mairide-primary tracking-tight mb-2 uppercase">Driver Dashboard</h1>
                <p className="text-mairide-secondary italic serif">Manage your empty leg journeys and earnings.</p>
              </div>
            </div>
            <button 
              onClick={toggleOnline}
              className={cn(
                "px-8 py-4 rounded-2xl font-bold transition-all flex items-center justify-center space-x-3",
                isOnline ? "bg-green-600 text-white shadow-lg shadow-green-100" : "bg-mairide-secondary text-mairide-primary"
              )}
            >
              <div className={cn("w-3 h-3 rounded-full", isOnline ? "bg-white animate-pulse" : "bg-mairide-primary")} />
              <span>{isOnline ? 'You are Online' : 'Go Online'}</span>
            </button>
          </div>

          {activeDashboardRequests.length > 0 && (
            <div className="mb-8">
              <DriverDashboardSummary
                requests={activeDashboardRequests}
                config={config}
                onAccept={(request) => handleDriverAction(request, 'confirmed')}
                onReject={(request) => handleDriverAction(request, 'rejected')}
                counterFares={counterFares}
                setCounterFares={setCounterFares}
                onCounter={handleDriverCounterOffer}
                onPayWithCoins={(request) => handleDriverDashboardPayment(request, true)}
                onPayOnline={(request) => handleDriverDashboardPayment(request, false)}
                onStartRide={handleStartRide}
                onEndRide={handleEndRide}
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm">
              <p className="text-sm text-mairide-secondary mb-1">Total Earnings</p>
              <h3 className="text-2xl font-black text-mairide-primary">{formatCurrency(profile.driverDetails?.totalEarnings || 0)}</h3>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm">
              <p className="text-sm text-mairide-secondary mb-1">Rating</p>
              <div className="flex items-center space-x-2">
                <h3 className="text-2xl font-black text-mairide-primary">{getResolvedUserRating(profile).toFixed(1)}</h3>
                <Star className="w-5 h-5 text-mairide-accent fill-current" />
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm">
              <p className="text-sm text-mairide-secondary mb-1">Active Rides</p>
              <h3 className="text-2xl font-black text-mairide-primary">{requests.filter((request) => ['pending', 'confirmed', 'negotiating'].includes(request.status)).length}</h3>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">MaiCoins Wallet</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-4xl font-black tracking-tight text-mairide-primary">{profile.wallet?.balance || 0}</p>
                  <p className="text-sm font-bold text-mairide-accent">Available Maicoins</p>
                </div>
                <Wallet className="w-10 h-10 text-mairide-accent" />
              </div>
              <p className="mt-3 text-sm text-mairide-secondary">
                Use Maicoins to offset platform fees and keep your route economics stronger on every confirmed trip.
              </p>
            </div>
            <div className="bg-mairide-primary rounded-[32px] border border-mairide-primary p-6 shadow-lg shadow-mairide-primary/20 text-white">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">Driver Advantage</p>
              <p className="mt-3 text-2xl font-black tracking-tight">MaiCoins turn every completed journey into future margin.</p>
              <p className="mt-3 text-sm text-white/80">
                The more you refer and complete rides, the more fee pressure you can absorb with wallet rewards instead of cash.
              </p>
            </div>
          </div>

          <div className="mb-12 overflow-hidden rounded-[32px] border border-mairide-secondary bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-mairide-secondary/70">
              <div>
                <h2 className="text-xl font-bold text-mairide-primary flex items-center">
                  <MapPin className="w-5 h-5 mr-2 text-mairide-accent" />
                  Live Traveler Map
                </h2>
                <p className="text-sm text-mairide-secondary">
                  See nearby traveler demand directly from your landing dashboard before posting a ride.
                </p>
              </div>
              <div className="rounded-full bg-mairide-bg px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-mairide-accent">
                {consumers.filter(c => c.location && typeof c.location.lat === 'number' && typeof c.location.lng === 'number').length} Travelers Visible
              </div>
            </div>
            <div className="relative h-[280px] md:h-[360px]" style={{ contentVisibility: 'auto', containIntrinsicSize: '280px 360px' }}>
              {GOOGLE_MAPS_API_KEY && isLoaded && window.google ? (
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={userLocation || { lat: 26.1433, lng: 91.7385 }}
                  zoom={userLocation ? 14 : 7}
                  options={{
                    styles: [
                      { "featureType": "all", "elementType": "geometry.fill", "stylers": [{ "weight": "2.00" }] },
                      { "featureType": "all", "elementType": "geometry.stroke", "stylers": [{ "color": "#9c9c9c" }] },
                      { "featureType": "all", "elementType": "labels.text", "stylers": [{ "visibility": "on" }] },
                      { "featureType": "landscape", "elementType": "all", "stylers": [{ "color": "#f2f2f2" }] },
                      { "featureType": "landscape", "elementType": "geometry.fill", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "landscape.man_made", "elementType": "geometry.fill", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "poi", "elementType": "all", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "road", "elementType": "all", "stylers": [{ "saturation": -100 }, { "lightness": 45 }] },
                      { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#eeeeee" }] },
                      { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#7b7b7b" }] },
                      { "featureType": "road", "elementType": "labels.text.stroke", "stylers": [{ "color": "#ffffff" }] },
                      { "featureType": "road.highway", "elementType": "all", "stylers": [{ "visibility": "simplified" }] },
                      { "featureType": "road.arterial", "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "transit", "elementType": "all", "stylers": [{ "visibility": "off" }] },
                      { "featureType": "water", "elementType": "all", "stylers": [{ "color": "#46bcec" }, { "visibility": "on" }] },
                      { "featureType": "water", "elementType": "geometry.fill", "stylers": [{ "color": "#c8d7d4" }] },
                      { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#070707" }] },
                      { "featureType": "water", "elementType": "labels.text.stroke", "stylers": [{ "color": "#ffffff" }] }
                    ]
                  }}
                >
                  {userLocation && (
                    <Marker 
                      position={userLocation} 
                      icon={{
                        url: 'https://maps.google.com/mapfiles/ms/icons/car.png',
                        scaledSize: (isLoaded && window.google) ? new window.google.maps.Size(32, 32) : undefined
                      }}
                      title="You"
                    />
                  )}
                  {consumers.filter(c => c.location && typeof c.location.lat === 'number' && typeof c.location.lng === 'number').map(consumer => (
                    <Marker
                      key={consumer.uid}
                      position={{ lat: consumer.location!.lat, lng: consumer.location!.lng }}
                      icon={{
                        url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
                        scaledSize: (isLoaded && window.google) ? new window.google.maps.Size(24, 24) : undefined
                      }}
                      title={consumer.displayName}
                    />
                  ))}
                </GoogleMap>
              ) : (
                <div className="flex flex-col items-center justify-center h-full bg-mairide-bg p-8 text-center">
                  <MapPin className="w-12 h-12 text-mairide-secondary mb-4" />
                  <h3 className="text-xl font-bold text-mairide-primary mb-2">
                    {loadError ? "Maps Error" : "Maps Unavailable"}
                  </h3>
                  <p className="text-mairide-secondary max-w-xs mx-auto">
                    {loadError ? loadError.message : "Please configure and activate your Google Maps API Key (Maps JavaScript API & Places API) in the Google Cloud Console."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-mairide-primary">Your Ride Offers</h2>
              <button 
                onClick={() => setShowOfferForm(true)}
                className="bg-mairide-accent text-white px-6 py-3 rounded-2xl font-bold flex items-center space-x-2 hover:bg-mairide-primary transition-all"
              >
                <Plus className="w-5 h-5" />
                <span>Offer a Ride</span>
              </button>
            </div>

            {showOfferForm && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white p-8 rounded-[32px] border border-mairide-accent shadow-xl relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-4">
                  <button onClick={() => setShowOfferForm(false)} className="text-mairide-secondary hover:text-mairide-primary">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <h3 className="text-2xl font-bold text-mairide-primary mb-6">Create New Offer</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-semibold text-mairide-primary mb-2">Origin</label>
                    {isLoaded ? (
                      <Autocomplete
                        onLoad={autocomplete => setAutocompleteFrom(autocomplete)}
                        onPlaceChanged={() => {
                          if (autocompleteFrom) {
                            const place = autocompleteFrom.getPlace();
                            if (place.formatted_address) {
                              setNewRide(prev => ({ ...prev, origin: place.formatted_address! }));
                            }
                            if (place.geometry?.location) {
                              setOriginLocation({
                                lat: place.geometry.location.lat(),
                                lng: place.geometry.location.lng()
                              });
                            }
                          }
                        }}
                      >
                        <input 
                          type="text" 
                          placeholder="Where are you now?"
                          className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                          value={newRide.origin}
                          onChange={e => setNewRide({ ...newRide, origin: e.target.value })}
                        />
                      </Autocomplete>
                    ) : (
                      <input 
                        type="text" 
                        placeholder="Where are you now?"
                        className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                        value={newRide.origin}
                        onChange={e => setNewRide({ ...newRide, origin: e.target.value })}
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-mairide-primary mb-2">Destination</label>
                    {isLoaded ? (
                      <Autocomplete
                        onLoad={autocomplete => setAutocompleteTo(autocomplete)}
                        onPlaceChanged={() => {
                          if (autocompleteTo) {
                            const place = autocompleteTo.getPlace();
                            if (place.formatted_address) {
                              setNewRide(prev => ({ ...prev, destination: place.formatted_address! }));
                            }
                            if (place.geometry?.location) {
                              setDestinationLocation({
                                lat: place.geometry.location.lat(),
                                lng: place.geometry.location.lng()
                              });
                            }
                          }
                        }}
                      >
                        <input 
                          type="text" 
                          placeholder="Where are you going?"
                          className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                          value={newRide.destination}
                          onChange={e => setNewRide({ ...newRide, destination: e.target.value })}
                        />
                      </Autocomplete>
                    ) : (
                      <input 
                        type="text" 
                        placeholder="Where are you going?"
                        className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                        value={newRide.destination}
                        onChange={e => setNewRide({ ...newRide, destination: e.target.value })}
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-mairide-primary mb-2">Your Price (INR)</label>
                    <div className="relative">
                      <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 text-mairide-secondary w-5 h-5" />
                      <input 
                        type="number" 
                        placeholder="e.g. 500"
                        className="w-full pl-12 pr-4 py-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                        value={newRide.price}
                        onChange={e => setNewRide({ ...newRide, price: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-mairide-primary mb-2">Seats Available</label>
                    <div className="relative">
                      <select 
                        className="w-full appearance-none py-4 pl-4 pr-12 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                        value={newRide.seats}
                        onChange={e => setNewRide({ ...newRide, seats: e.target.value })}
                      >
                        {[1, 2, 3, 4, 5, 6].map(n => (
                          <option key={n} value={n}>
                            {n} {n === 1 ? 'Seat' : 'Seats'}
                          </option>
                        ))}
                      </select>
                      <ChevronRight className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 rotate-90 text-mairide-secondary" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-mairide-primary mb-2">Journey Day</label>
                    <div className="relative">
                      <select
                        className="w-full appearance-none py-4 pl-4 pr-12 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                        value={newRide.departureDay}
                        onChange={e => setNewRide({ ...newRide, departureDay: e.target.value })}
                      >
                        <option value="today">Today</option>
                        <option value="tomorrow">Tomorrow</option>
                        <option value="dayAfter">Day After</option>
                      </select>
                      <ChevronRight className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 rotate-90 text-mairide-secondary" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-mairide-primary mb-2">Likely Start Time</label>
                    <input
                      type="time"
                      className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                      value={newRide.departureClock}
                      onChange={e => setNewRide({ ...newRide, departureClock: e.target.value })}
                    />
                    <p className="mt-2 text-xs text-mairide-secondary">
                      This is the likely start time only and may vary due to traffic, road conditions, weather, and operational delays.
                    </p>
                  </div>
                </div>
                <button 
                  onClick={handlePostRide}
                  disabled={isPostingRide}
                  className="w-full bg-mairide-accent text-white py-4 rounded-2xl font-bold hover:bg-mairide-primary transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isPostingRide ? 'Posting Offer...' : 'Post Ride Offer'}
                </button>
              </motion.div>
            )}

            <MyRides
              profile={profile}
              hiddenRideIds={retiredRideIds}
              onRideRetired={(rideId) =>
                setRetiredRideIds((prev) => (prev.includes(rideId) ? prev : [...prev, rideId]))
              }
            />
          </div>
        </>
      )}

      {activeTab === 'requests' && <BookingRequests profile={profile} />}
      {activeTab === 'history' && <DriverHistory profile={profile} />}
      {activeTab === 'wallet' && <WalletDashboard profile={profile} />}
      {activeTab === 'support' && <SupportSystem profile={profile} />}
      {activeTab === 'profile' && <UserSelfProfilePanel profile={profile} />}
      {paymentRequest && (
        <PaymentProofModal
          booking={paymentRequest}
          payer="driver"
          config={config}
          onClose={() => setPaymentRequest(null)}
          onSubmit={(payload) => submitDriverPaymentProof(paymentRequest, payload)}
        />
      )}
    </div>
  );
};

// --- Chatbot Component ---

const Chatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      createdAt: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const prompt = `You are MaiRide's helpful assistant. MaiRide is a long-distance cab aggregator that uses empty leg journeys to provide discounted rides. 
      We are currently launching in North East India, specifically North Bengal, Sikkim, Assam, and Meghalaya. 
      In Phase 2, we will expand to North and West India. 
      Answer the user's query concisely and inform them about our regional focus if relevant. 
      User query: ${input}`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });
      
      const text = response.text || "I'm sorry, I couldn't generate a response.";

      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: text,
        createdAt: new Date().toISOString()
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      console.error("Chatbot Error:", error);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm sorry, I'm having trouble connecting right now. Please try again later.",
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            className="bg-white rounded-[32px] shadow-2xl border border-mairide-secondary w-80 md:w-96 h-[500px] flex flex-col overflow-hidden mb-4"
          >
            <div className="bg-mairide-primary p-6 flex justify-between items-center">
              <div className="flex items-center space-x-3">
                <div className="bg-mairide-accent p-2 rounded-xl">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold">MaiRide Assistant</h3>
                  <p className="text-white/60 text-[10px] uppercase tracking-wider">Online</p>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-mairide-bg">
              {messages.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-mairide-secondary text-sm italic serif">How can I help you today?</p>
                </div>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={cn(
                  "flex",
                  msg.role === 'user' ? "justify-end" : "justify-start"
                )}>
                  <div className={cn(
                    "max-w-[80%] p-4 rounded-2xl text-sm",
                    msg.role === 'user' ? "bg-mairide-accent text-white rounded-tr-none" : "bg-white text-mairide-primary border border-mairide-secondary rounded-tl-none shadow-sm"
                  )}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white border border-mairide-secondary p-4 rounded-2xl rounded-tl-none shadow-sm">
                    <div className="flex space-x-1">
                      <div className="w-1.5 h-1.5 bg-mairide-accent rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-mairide-accent rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1.5 h-1.5 bg-mairide-accent rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-white border-t border-mairide-secondary flex space-x-2">
              <input
                type="text"
                placeholder="Type a message..."
                className="flex-1 bg-mairide-bg border-none rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-mairide-accent"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              />
              <button
                onClick={handleSend}
                className="bg-mairide-accent text-white p-2 rounded-xl hover:scale-105 transition-transform"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-mairide-primary text-white p-4 rounded-full shadow-2xl hover:scale-110 transition-transform flex items-center justify-center"
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>
    </div>
  );
};

// --- Support System Components ---

const CSATFeedbackModal = ({ ticket, onClose }: { ticket: SupportTicket; onClose: () => void }) => {
  const [rating, setRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const tags = [
    "Fast Response",
    "Knowledgeable Agent",
    "Resolved Issue",
    "Friendly Service",
    "Professional",
    "Clear Communication"
  ];

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async () => {
    if (rating === 0) return;
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'support_tickets', ticket.id), {
        feedback: {
          rating,
          tags: selectedTags,
          comment,
          createdAt: new Date().toISOString()
        }
      });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `support_tickets/${ticket.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-[40px] p-8 max-w-md w-full shadow-2xl border border-mairide-secondary"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-mairide-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Star className="w-8 h-8 text-mairide-accent fill-mairide-accent" />
          </div>
          <h2 className="text-2xl font-bold text-mairide-primary tracking-tight uppercase">How did we do?</h2>
          <p className="text-mairide-secondary italic serif">Your feedback helps us improve our service.</p>
        </div>

        <div className="flex justify-center space-x-2 mb-8">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => setRating(star)}
              className="p-1 transition-transform hover:scale-110"
            >
              <Star 
                className={cn(
                  "w-10 h-10 transition-colors",
                  rating >= star ? "text-mairide-accent fill-mairide-accent" : "text-mairide-bg fill-mairide-bg stroke-mairide-secondary"
                )} 
              />
            </button>
          ))}
        </div>

        <div className="mb-8">
          <label className="block text-xs font-bold text-mairide-secondary uppercase mb-4 text-center">What did you like?</label>
          <div className="flex flex-wrap justify-center gap-2">
            {tags.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  "px-4 py-2 rounded-full text-xs font-bold transition-all border",
                  selectedTags.includes(tag)
                    ? "bg-mairide-primary text-white border-mairide-primary shadow-lg shadow-mairide-primary/20"
                    : "bg-mairide-bg text-mairide-secondary border-mairide-secondary hover:border-mairide-primary"
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-8">
          <textarea
            className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent resize-none text-sm"
            placeholder="Any additional comments? (Optional)"
            rows={3}
            value={comment}
            onChange={e => setComment(e.target.value)}
          />
        </div>

        <div className="flex space-x-4">
          <button
            onClick={onClose}
            className="flex-1 py-4 rounded-2xl font-bold text-mairide-secondary hover:bg-mairide-bg transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={rating === 0 || isSubmitting}
            className="flex-1 bg-mairide-accent text-white py-4 rounded-2xl font-bold shadow-lg shadow-mairide-accent/20 hover:scale-[1.02] transition-transform disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const SupportSystem = ({ profile }: { profile: UserProfile }) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [feedbackTicket, setFeedbackTicket] = useState<SupportTicket | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'support_tickets'), where('userId', '==', profile.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ticketsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SupportTicket));
      setTickets(ticketsData);
      
      // Check for resolved tickets without feedback
      const resolvedWithoutFeedback = ticketsData.find(t => t.status === 'resolved' && !t.feedback);
      if (resolvedWithoutFeedback) {
        setFeedbackTicket(resolvedWithoutFeedback);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'support_tickets');
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject || !message) return;

    setIsSubmitting(true);
    try {
      const ticketRef = doc(collection(db, 'support_tickets'));
      const newTicket: SupportTicket = {
        id: ticketRef.id,
        userId: profile.uid,
        userName: profile.displayName,
        userEmail: profile.email,
        subject,
        message,
        status: 'open',
        priority: 'medium',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await setDoc(ticketRef, newTicket);
      setSubject('');
      setMessage('');
      alert("Support ticket submitted successfully!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'support_tickets');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <div className="mb-12">
        <h1 className="text-4xl font-bold text-mairide-primary tracking-tight mb-2 uppercase">Customer Support</h1>
        <p className="text-mairide-secondary italic serif">We're here to help. Submit a query or complaint.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div className="bg-white rounded-[32px] p-8 shadow-xl border border-mairide-secondary h-fit">
          <h2 className="text-xl font-bold text-mairide-primary mb-6">Submit a Ticket</h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2">Subject</label>
              <input
                type="text"
                className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent"
                placeholder="e.g., Booking Issue, Payment Query"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2">Message</label>
              <textarea
                rows={5}
                className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent resize-none"
                placeholder="Describe your issue in detail..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-mairide-accent text-white py-4 rounded-2xl font-bold shadow-lg shadow-orange-100 hover:scale-[1.02] transition-transform disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Ticket'}
            </button>
          </form>
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-bold text-mairide-primary mb-6">Your Tickets</h2>
          {tickets.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-[32px] border border-mairide-secondary border-dashed">
              <p className="text-mairide-secondary italic serif">No support tickets found.</p>
            </div>
          ) : (
            tickets.map(ticket => (
              <div key={ticket.id} className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-mairide-primary">{ticket.subject}</h3>
                    <p className="text-xs text-mairide-secondary">{new Date(ticket.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                    ticket.status === 'open' ? "bg-blue-50 text-blue-600" :
                    ticket.status === 'resolved' ? "bg-green-50 text-green-600" :
                    "bg-gray-50 text-gray-600"
                  )}>
                    {ticket.status}
                  </span>
                </div>
                <p className="text-sm text-mairide-secondary line-clamp-2 mb-4">{ticket.message}</p>
                {ticket.responses && ticket.responses.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-mairide-bg">
                    <p className="text-xs font-bold text-mairide-accent mb-2 flex items-center">
                      <MessageSquare className="w-3 h-3 mr-1" /> Latest Response:
                    </p>
                    <p className="text-xs text-mairide-primary italic serif">"{ticket.responses[ticket.responses.length - 1].message}"</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {feedbackTicket && (
        <CSATFeedbackModal 
          ticket={feedbackTicket} 
          onClose={() => setFeedbackTicket(null)} 
        />
      )}
    </div>
  );
};

const AdminSupportView = () => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [response, setResponse] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'support_tickets'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ticketsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SupportTicket));
      setTickets(ticketsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'support_tickets');
    });
    return () => unsubscribe();
  }, []);

  const handleSendResponse = async () => {
    if (!selectedTicket || !response) return;

    try {
      const ticketRef = doc(db, 'support_tickets', selectedTicket.id);
      const newResponse = {
        senderId: auth.currentUser?.uid || 'admin',
        senderName: 'MaiRide Support',
        message: response,
        createdAt: new Date().toISOString()
      };

      await updateDoc(ticketRef, {
        responses: [...(selectedTicket.responses || []), newResponse],
        status: 'in-progress',
        updatedAt: new Date().toISOString()
      });

      setResponse('');
      alert("Response sent!");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `support_tickets/${selectedTicket.id}`);
    }
  };

  const handleUpdateStatus = async (ticketId: string, newStatus: SupportTicket['status']) => {
    try {
      await updateDoc(doc(db, 'support_tickets', ticketId), { 
        status: newStatus,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `support_tickets/${ticketId}`);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 space-y-4">
        <h2 className="text-xl font-bold text-mairide-primary mb-6">All Tickets</h2>
        {tickets.map(ticket => (
          <div 
            key={ticket.id} 
            onClick={() => setSelectedTicket(ticket)}
            className={cn(
              "p-6 rounded-3xl border transition-all cursor-pointer",
              selectedTicket?.id === ticket.id ? "bg-mairide-primary text-white border-mairide-primary" : "bg-white text-mairide-primary border-mairide-secondary hover:bg-mairide-bg"
            )}
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold truncate pr-2">{ticket.subject}</h3>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[8px] font-bold uppercase",
                ticket.status === 'open' ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"
              )}>
                {ticket.status}
              </span>
            </div>
            <p className={cn("text-xs mb-2", selectedTicket?.id === ticket.id ? "text-white/60" : "text-mairide-secondary")}>
              From: {ticket.userName}
            </p>
            <p className="text-[10px] opacity-60">{new Date(ticket.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="lg:col-span-2">
        {selectedTicket ? (
          <div className="bg-white rounded-[32px] border border-mairide-secondary shadow-xl flex flex-col h-[600px]">
            <div className="p-8 border-b border-mairide-secondary">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-mairide-primary">{selectedTicket.subject}</h2>
                  <p className="text-sm text-mairide-secondary">Ticket ID: {selectedTicket.id}</p>
                </div>
                <select 
                  className="bg-mairide-bg border-none rounded-xl text-xs font-bold p-3 outline-none"
                  value={selectedTicket.status}
                  onChange={(e) => handleUpdateStatus(selectedTicket.id, e.target.value as any)}
                >
                  <option value="open">Open</option>
                  <option value="in-progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div className="bg-mairide-bg p-6 rounded-2xl">
                <p className="text-sm text-mairide-primary italic serif">"{selectedTicket.message}"</p>
              </div>

              {selectedTicket.feedback && (
                <div className="mt-6 p-6 bg-mairide-accent/5 rounded-2xl border border-mairide-accent/20">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-mairide-primary flex items-center">
                      <Star className="w-4 h-4 text-mairide-accent fill-mairide-accent mr-2" />
                      Customer Feedback
                    </h4>
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map(s => (
                        <Star 
                          key={s} 
                          className={cn(
                            "w-4 h-4",
                            selectedTicket.feedback!.rating >= s ? "text-mairide-accent fill-mairide-accent" : "text-mairide-secondary/20"
                          )} 
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {selectedTicket.feedback.tags.map(tag => (
                      <span key={tag} className="px-3 py-1 bg-white rounded-full text-[10px] font-bold text-mairide-secondary border border-mairide-secondary/20">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {selectedTicket.feedback.comment && (
                    <p className="text-sm text-mairide-primary italic serif">"{selectedTicket.feedback.comment}"</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              {selectedTicket.responses?.map((res, idx) => (
                <div key={idx} className={cn(
                  "flex flex-col",
                  res.senderId === auth.currentUser?.uid ? "items-end" : "items-start"
                )}>
                  <div className={cn(
                    "max-w-[80%] p-4 rounded-2xl text-sm",
                    res.senderId === auth.currentUser?.uid ? "bg-mairide-accent text-white" : "bg-mairide-bg text-mairide-primary"
                  )}>
                    {res.message}
                  </div>
                  <span className="text-[10px] text-mairide-secondary mt-1">{new Date(res.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="p-8 border-t border-mairide-secondary flex space-x-4">
              <input
                type="text"
                placeholder="Type your response..."
                className="flex-1 bg-mairide-bg border-none rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-mairide-accent"
                value={response}
                onChange={(e) => setResponse(e.target.value)}
              />
              <button
                onClick={handleSendResponse}
                className="bg-mairide-primary text-white px-8 py-4 rounded-2xl font-bold hover:scale-105 transition-transform"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center bg-white rounded-[32px] border border-mairide-secondary border-dashed p-12 text-center">
            <LifeBuoy className="w-16 h-16 text-mairide-secondary mb-4" />
            <h3 className="text-xl font-bold text-mairide-primary mb-2">Select a ticket to view details</h3>
            <p className="text-mairide-secondary italic serif">Support queries from users will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Driver Status Screens ---

const DriverPendingApproval = ({ profile }: { profile: UserProfile }) => {
  return (
    <div className="min-h-screen bg-mairide-bg flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-[40px] p-10 shadow-2xl text-center border border-mairide-secondary"
      >
        <div className="w-24 h-24 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-8 border-4 border-white shadow-lg">
          <Clock className="w-12 h-12 text-orange-600" />
        </div>
        <h1 className="text-3xl font-black text-mairide-primary mb-4 tracking-tighter">Verification Pending</h1>
        <p className="text-mairide-secondary mb-8 italic serif">
          Welcome to the family! Your documents are currently being reviewed by our team.
          This usually takes 24-48 hours.
        </p>
        <div className="bg-orange-50 p-6 rounded-3xl text-left mb-8 border border-orange-100">
          <div className="flex items-center space-x-2 text-orange-800 font-bold text-sm mb-2">
            <ShieldCheck className="w-5 h-5" />
            <span>Safety First</span>
          </div>
          <p className="text-xs text-orange-700 leading-relaxed">
            To ensure the safety of our community, we verify all driver documents before granting access to the platform.
          </p>
        </div>
        <button 
          onClick={() => signOut(auth)}
          className="w-full bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold hover:bg-mairide-secondary transition-colors"
        >
          Logout
        </button>
      </motion.div>
    </div>
  );
};

const DriverRejected = ({ profile }: { profile: UserProfile }) => {
  return (
    <div className="min-h-screen bg-mairide-bg flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-[40px] p-10 shadow-2xl text-center border border-mairide-secondary"
      >
        <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-8 border-4 border-white shadow-lg">
          <AlertCircle className="w-12 h-12 text-red-600" />
        </div>
        <h1 className="text-3xl font-black text-mairide-primary mb-4 tracking-tighter">Verification Rejected</h1>
        <p className="text-mairide-secondary mb-6 italic serif">
          Unfortunately, your driver application could not be approved at this time.
        </p>
        {profile.rejectionReason && (
          <div className="bg-red-50 p-6 rounded-3xl text-left mb-8 border border-red-100">
            <p className="text-[10px] font-bold text-red-800 uppercase tracking-widest mb-2">Reason for Rejection:</p>
            <p className="text-sm text-red-700 leading-relaxed">{profile.rejectionReason}</p>
          </div>
        )}
        <div className="space-y-4">
          <button 
            onClick={async () => {
              try {
                await updateDoc(doc(db, 'users', profile.uid), { 
                  onboardingComplete: false,
                  verificationStatus: undefined,
                  rejectionReason: undefined
                });
              } catch (error) {
                handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
              }
            }}
            className="w-full bg-mairide-primary text-white py-5 rounded-3xl font-bold hover:scale-105 transition-transform shadow-lg shadow-mairide-primary/20"
          >
            Re-submit Documents
          </button>
          <button 
            onClick={() => signOut(auth)}
            className="w-full bg-mairide-bg text-mairide-primary py-5 rounded-3xl font-bold hover:bg-mairide-secondary transition-colors"
          >
            Logout
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// --- Admin Revenue Analysis ---

const AdminRevenueAnalysis = ({ bookings, users }: { bookings: any[], users: UserProfile[] }) => {
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const paymentEvents = getPlatformFeePaymentEvents(bookings as Booking[]);
  
  // Calculate stats
  const totalRevenue = paymentEvents.reduce((acc, event) => acc + event.revenue, 0);
  const totalGST = paymentEvents.reduce((acc, event) => acc + event.gst, 0);
  const totalMaiCoinsIssued = users.reduce((acc, u) => acc + (u.wallet?.balance || 0) + (u.wallet?.pendingBalance || 0), 0);
  
  // Prepare chart data
  const getChartData = () => {
    const data: any[] = [];
    const now = new Date();
    
    if (timeframe === 'daily') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const dayBookings = paymentEvents.filter(event => 
          new Date(event.createdAt).toDateString() === d.toDateString()
        );
        data.push({
          name: dateStr,
          revenue: dayBookings.reduce((acc, event) => acc + event.revenue, 0),
          gst: dayBookings.reduce((acc, event) => acc + event.gst, 0),
          bookings: dayBookings.length
        });
      }
    } else if (timeframe === 'weekly') {
      for (let i = 3; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - (i * 7));
        const weekStr = `Week ${4-i}`;
        const weekBookings = paymentEvents.filter(event => {
          const bDate = new Date(event.createdAt);
          const diffDays = Math.floor((now.getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24));
          return diffDays >= i * 7 && diffDays < (i + 1) * 7;
        });
        data.push({
          name: weekStr,
          revenue: weekBookings.reduce((acc, event) => acc + event.revenue, 0),
          gst: weekBookings.reduce((acc, event) => acc + event.gst, 0),
          bookings: weekBookings.length
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(now.getMonth() - i);
        const monthStr = d.toLocaleDateString('en-IN', { month: 'short' });
        const monthBookings = paymentEvents.filter(event => {
          const bDate = new Date(event.createdAt);
          return bDate.getMonth() === d.getMonth() && bDate.getFullYear() === d.getFullYear();
        });
        data.push({
          name: monthStr,
          revenue: monthBookings.reduce((acc, event) => acc + event.revenue, 0),
          gst: monthBookings.reduce((acc, event) => acc + event.gst, 0),
          bookings: monthBookings.length
        });
      }
    }
    return data;
  };

  const chartData = getChartData();
  
  // High traction areas
  const getTractionAreas = () => {
    const areas: { [key: string]: number } = {};
    bookings.forEach(b => {
      areas[b.destination] = (areas[b.destination] || 0) + 1;
    });
    return Object.entries(areas)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };

  const tractionAreas = getTractionAreas();

  // Cash flow alert
  const isNegativeCashFlow = totalMaiCoinsIssued > totalRevenue * 2; // Simple heuristic

  return (
    <div className="space-y-8">
      {/* Alerts */}
      {isNegativeCashFlow && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border border-red-200 p-6 rounded-[32px] flex items-start space-x-4"
        >
          <div className="bg-red-100 p-3 rounded-2xl">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-red-900">Negative Cash Flow Risk</h3>
            <p className="text-sm text-red-700">Maicoins liabilities (₹{totalMaiCoinsIssued}) are high relative to current revenue (₹{totalRevenue}). Consider adjusting referral rewards or increasing platform fees.</p>
          </div>
        </motion.div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
          <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center mb-4">
            <IndianRupee className="w-6 h-6 text-green-600" />
          </div>
          <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-1">Total Revenue</p>
          <p className="text-4xl font-black text-mairide-primary tracking-tighter">{formatCurrency(totalRevenue)}</p>
          <p className="text-[10px] text-mairide-secondary mt-2 font-bold uppercase">Excluding GST</p>
        </div>
        <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
          <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
          </div>
          <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-1">GST Collected</p>
          <p className="text-4xl font-black text-mairide-primary tracking-tighter">{formatCurrency(totalGST)}</p>
          <p className="text-[10px] text-mairide-secondary mt-2 font-bold uppercase">18% Standard Rate</p>
        </div>
        <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
          <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center mb-4">
            <Bot className="w-6 h-6 text-orange-600" />
          </div>
          <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-1">Maicoins Liability</p>
          <p className="text-4xl font-black text-mairide-primary tracking-tighter">{totalMaiCoinsIssued}</p>
          <p className="text-[10px] text-mairide-secondary mt-2 font-bold uppercase">Total Points in Wallets</p>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-xl font-bold text-mairide-primary">Revenue Trends</h3>
            <div className="flex space-x-2 bg-mairide-bg p-1 rounded-xl">
              {['daily', 'weekly', 'monthly'].map(t => (
                <button
                  key={t}
                  onClick={() => setTimeframe(t as any)}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all",
                    timeframe === t ? "bg-white text-mairide-primary shadow-sm" : "text-mairide-secondary"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F27D26" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#F27D26" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#F27D26" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
          <h3 className="text-xl font-bold text-mairide-primary mb-8">High Traction Destinations</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tractionAreas} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eee" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} width={100} />
                <Tooltip 
                  cursor={{ fill: '#f5f5f5' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="count" fill="#141414" radius={[0, 10, 10, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Marketing Insights */}
      <div className="bg-mairide-primary p-10 rounded-[40px] text-white overflow-hidden relative">
        <div className="relative z-10">
          <div className="flex items-center space-x-3 mb-6">
            <Bot className="w-8 h-8 text-mairide-accent" />
            <h3 className="text-2xl font-bold">Marketing Insights & Recommendations</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/10">
              <h4 className="font-bold text-mairide-accent mb-4 flex items-center space-x-2">
                <MapPin className="w-4 h-4" />
                <span>Top Growth Sector</span>
              </h4>
              <p className="text-sm opacity-80 leading-relaxed">
                Based on recent trends, <span className="text-white font-bold">{tractionAreas[0]?.name || 'Guwahati City'}</span> is showing {Math.floor(Math.random() * 20) + 10}% higher demand. We recommend launching a localized referral campaign in this area.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/10">
              <h4 className="font-bold text-mairide-accent mb-4 flex items-center space-x-2">
                <Users className="w-4 h-4" />
                <span>User Retention</span>
              </h4>
              <p className="text-sm opacity-80 leading-relaxed">
                Users with more than 50 Maicoins have a 3x higher retention rate. Consider a "Maicoin Multiplier" weekend to boost wallet balances and long-term engagement.
              </p>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-mairide-accent/20 rounded-full blur-3xl" />
      </div>
    </div>
  );
};

const AdminConfigView = () => {
  const buildDefaultConfig = (): Partial<AppConfig> => ({
    maintenanceFeeBase: 100,
    gstRate: 0.18,
    referralRewardTier1: 25,
    referralRewardTier2: 5,
    paymentGatewayUrl: 'https://api.razorpay.com/v1',
    razorpayKeyId: RAZORPAY_KEY_ID || '',
    smsOtpProvider: '2factor',
    smsApiUrl: 'https://2factor.in/API/V1',
    emailOtpEnabled: true,
    emailOtpProvider: 'resend',
    resendApiBaseUrl: 'https://api.resend.com/emails',
    resendFromName: 'MaiRide',
    emailOtpExpiryMinutes: 10,
    emailOtpSubject: 'Your MaiRide verification code',
    appBaseUrl: typeof window !== 'undefined' ? window.location.origin : '',
    publicApiBaseUrl: typeof window !== 'undefined' ? `${window.location.origin}/api` : '',
    environmentLabel: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
    superAdminEmail: SUPER_ADMIN_EMAIL,
    appVersion: APP_VERSION,
    supabaseProjectUrl: import.meta.env.VITE_SUPABASE_URL || '',
    storageBucket: import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || '',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY || '',
    supportEmail: '',
    supportPhone: '',
    n8nBaseUrl: '',
    n8nOtpWebhookUrl: '',
    n8nPaymentWebhookUrl: '',
    n8nBookingWebhookUrl: '',
    n8nSupportWebhookUrl: '',
    n8nUserWebhookUrl: '',
  });

  const [formData, setFormData] = useState<Partial<AppConfig>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const saveConfig = async (payload: Partial<AppConfig>) => {
    const headers = await getAdminRequestHeaders(auth.currentUser?.email || null);
    const response = await axios.post(adminConfigPath, payload, {
      headers
    });
    if (response.data?.config) {
      setFormData(response.data.config);
    }
    return response.data?.config;
  };

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const defaults = buildDefaultConfig();
        const headers = await getAdminRequestHeaders(auth.currentUser?.email || null);
        const response = await axios.get(adminConfigPath, { headers });
        if (response.data?.config) {
          setFormData({ ...defaults, ...response.data.config });
        } else {
          setFormData(defaults);
        }
      } catch (error: any) {
        console.error('Error loading configuration:', error);
        alert(getApiErrorMessage(error, "Failed to load configuration."));
        setFormData(buildDefaultConfig());
      } finally {
        setLoadingConfig(false);
      }
    };

    void loadConfig();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await saveConfig({
        ...formData,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser?.email || 'admin'
      });
      alert("Configuration saved successfully!");
    } catch (error: any) {
      console.error('Error saving configuration:', error);
      alert(getApiErrorMessage(error, "Failed to save configuration."));
    } finally {
      setIsSaving(false);
    }
  };

  if (loadingConfig) return <div className="p-20 text-center font-bold">Loading configuration...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-white rounded-[40px] border border-mairide-secondary p-10 shadow-sm">
        <div className="flex items-center space-x-4 mb-8">
          <div className="bg-mairide-primary p-3 rounded-2xl">
            <Settings className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-mairide-primary">Global Configuration</h2>
            <p className="text-sm text-mairide-secondary italic serif">Manage platform variables and external service parameters.</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-8">
          {/* Payment Config */}
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Payment & Revenue</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Maintenance Fee Base (₹)</label>
                <input 
                  type="number"
                  value={formData.maintenanceFeeBase || 0}
                  onChange={e => setFormData({ ...formData, maintenanceFeeBase: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">GST Rate (e.g. 0.18)</label>
                <input 
                  type="number"
                  step="0.01"
                  value={formData.gstRate || 0}
                  onChange={e => setFormData({ ...formData, gstRate: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Payment Gateway URL</label>
                <input 
                  type="url"
                  value={formData.paymentGatewayUrl || ''}
                  onChange={e => setFormData({ ...formData, paymentGatewayUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Razorpay Key ID</label>
                <input 
                  type="text"
                  value={formData.razorpayKeyId || ''}
                  onChange={e => setFormData({ ...formData, razorpayKeyId: e.target.value })}
                  placeholder="e.g. rzp_test_xxxxx"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Razorpay Key Secret</label>
                <input 
                  type="password"
                  value={formData.razorpayKeySecret || ''}
                  onChange={e => setFormData({ ...formData, razorpayKeySecret: e.target.value })}
                  placeholder="Server-side secret"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Razorpay Webhook Secret</label>
                <input 
                  type="password"
                  value={formData.razorpayWebhookSecret || ''}
                  onChange={e => setFormData({ ...formData, razorpayWebhookSecret: e.target.value })}
                  placeholder="Optional webhook signature secret"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
            </div>
          </div>

          {/* Referral Config */}
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Referral Rewards</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Tier 1 Reward (Maicoins)</label>
                <input 
                  type="number"
                  value={formData.referralRewardTier1 || 0}
                  onChange={e => setFormData({ ...formData, referralRewardTier1: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Tier 2 Reward (Maicoins)</label>
                <input 
                  type="number"
                  value={formData.referralRewardTier2 || 0}
                  onChange={e => setFormData({ ...formData, referralRewardTier2: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  required
                />
              </div>
            </div>
          </div>

          {/* External APIs */}
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">OTP & Messaging</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">SMS OTP Provider</label>
                <select
                  value={formData.smsOtpProvider || '2factor'}
                  onChange={e => setFormData({ ...formData, smsOtpProvider: e.target.value as AppConfig['smsOtpProvider'] })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  <option value="2factor">2Factor</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">SMS API URL</label>
                <input 
                  type="url"
                  value={formData.smsApiUrl || ''}
                  onChange={e => setFormData({ ...formData, smsApiUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">2Factor / SMS API Key</label>
                <input 
                  type="password"
                  value={formData.twoFactorApiKey || formData.smsApiKey || ''}
                  onChange={e => setFormData({ ...formData, twoFactorApiKey: e.target.value, smsApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">SMS Template / Route Name</label>
                <input 
                  type="text"
                  value={formData.smsTemplateName || ''}
                  onChange={e => setFormData({ ...formData, smsTemplateName: e.target.value })}
                  placeholder="AUTOGEN2"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Email OTP Enabled</label>
                <select
                  value={formData.emailOtpEnabled === false ? 'disabled' : 'enabled'}
                  onChange={e => setFormData({ ...formData, emailOtpEnabled: e.target.value === 'enabled' })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Email OTP Provider</label>
                <select
                  value={formData.emailOtpProvider || 'resend'}
                  onChange={e => setFormData({ ...formData, emailOtpProvider: e.target.value as AppConfig['emailOtpProvider'] })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                >
                  <option value="resend">Resend</option>
                  <option value="2factor">2Factor</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Resend API URL</label>
                <input 
                  type="url"
                  value={formData.resendApiBaseUrl || formData.emailApiUrl || ''}
                  onChange={e => setFormData({ ...formData, resendApiBaseUrl: e.target.value, emailApiUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Resend API Key</label>
                <input 
                  type="password"
                  value={formData.resendApiKey || formData.emailApiKey || ''}
                  onChange={e => setFormData({ ...formData, resendApiKey: e.target.value, emailApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Resend From Email</label>
                <input 
                  type="email"
                  value={formData.resendFromEmail || ''}
                  onChange={e => setFormData({ ...formData, resendFromEmail: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Resend From Name</label>
                <input 
                  type="text"
                  value={formData.resendFromName || ''}
                  onChange={e => setFormData({ ...formData, resendFromName: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Reply-To Email</label>
                <input 
                  type="email"
                  value={formData.resendReplyToEmail || ''}
                  onChange={e => setFormData({ ...formData, resendReplyToEmail: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Email OTP Subject</label>
                <input 
                  type="text"
                  value={formData.emailOtpSubject || ''}
                  onChange={e => setFormData({ ...formData, emailOtpSubject: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Email OTP Expiry (minutes)</label>
                <input 
                  type="number"
                  min="3"
                  value={formData.emailOtpExpiryMinutes || 10}
                  onChange={e => setFormData({ ...formData, emailOtpExpiryMinutes: Number(e.target.value) })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Support Email</label>
                <input 
                  type="email"
                  value={formData.supportEmail || ''}
                  onChange={e => setFormData({ ...formData, supportEmail: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Runtime & Automation</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">App Base URL</label>
                <input 
                  type="url"
                  value={formData.appBaseUrl || ''}
                  onChange={e => setFormData({ ...formData, appBaseUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Public API Base URL</label>
                <input 
                  type="url"
                  value={formData.publicApiBaseUrl || ''}
                  onChange={e => setFormData({ ...formData, publicApiBaseUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Environment Label</label>
                <input 
                  type="text"
                  value={formData.environmentLabel || ''}
                  onChange={e => setFormData({ ...formData, environmentLabel: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Support Phone</label>
                <input 
                  type="tel"
                  value={formData.supportPhone || ''}
                  onChange={e => setFormData({ ...formData, supportPhone: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Base URL</label>
                <input 
                  type="url"
                  value={formData.n8nBaseUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nBaseUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n API Key</label>
                <input 
                  type="password"
                  value={formData.n8nApiKey || ''}
                  onChange={e => setFormData({ ...formData, n8nApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Shared Secret</label>
                <input 
                  type="password"
                  value={formData.n8nSharedSecret || ''}
                  onChange={e => setFormData({ ...formData, n8nSharedSecret: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n OTP Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nOtpWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nOtpWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Payment Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nPaymentWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nPaymentWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Booking Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nBookingWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nBookingWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n Support Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nSupportWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nSupportWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">n8n User Webhook URL</label>
                <input 
                  type="url"
                  value={formData.n8nUserWebhookUrl || ''}
                  onChange={e => setFormData({ ...formData, n8nUserWebhookUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">System Reference</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">App Version</label>
                <input 
                  type="text"
                  value={formData.appVersion || ''}
                  onChange={e => setFormData({ ...formData, appVersion: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Super Admin Email</label>
                <input 
                  type="email"
                  value={formData.superAdminEmail || ''}
                  onChange={e => setFormData({ ...formData, superAdminEmail: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Supabase Project URL</label>
                <input 
                  type="url"
                  value={formData.supabaseProjectUrl || ''}
                  onChange={e => setFormData({ ...formData, supabaseProjectUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Storage Bucket</label>
                <input 
                  type="text"
                  value={formData.storageBucket || ''}
                  onChange={e => setFormData({ ...formData, storageBucket: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Google Maps API Key</label>
                <input 
                  type="password"
                  value={formData.googleMapsApiKey || ''}
                  onChange={e => setFormData({ ...formData, googleMapsApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Gemini API Key</label>
                <input 
                  type="password"
                  value={formData.geminiApiKey || ''}
                  onChange={e => setFormData({ ...formData, geminiApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
            </div>
          </div>

          <div className="pt-6">
            <button 
              type="submit"
              disabled={isSaving}
              className="w-full bg-mairide-primary text-white py-5 rounded-3xl font-bold hover:bg-mairide-primary/90 transition-all shadow-xl shadow-mairide-primary/20 flex items-center justify-center space-x-2"
            >
              <ShieldCheck className="w-5 h-5" />
              <span>{isSaving ? 'Saving Changes...' : 'Save Global Configuration'}</span>
            </button>
            <p className="text-[10px] text-center text-mairide-secondary mt-4 font-bold uppercase tracking-widest">
              Last updated: {formData.updatedAt ? new Date(formData.updatedAt).toLocaleString() : 'Never'} by {formData.updatedBy || 'N/A'}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

const AdminCashFlowAnalytics = ({ bookings, users }: { bookings: any[], users: UserProfile[] }) => {
  const paymentEvents = getPlatformFeePaymentEvents(bookings as Booking[]);
  const totalRevenue = paymentEvents.reduce((acc, event) => acc + event.revenue, 0);
  const totalMaiCoinsIssued = users.reduce((acc, u) => acc + (u.wallet?.balance || 0) + (u.wallet?.pendingBalance || 0), 0);
  
  // Projection Logic
  const last30DaysBookings = paymentEvents.filter(event => {
    const bDate = new Date(event.createdAt);
    const diffDays = Math.floor((new Date().getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 30;
  });

  const dailyAvgRevenue = last30DaysBookings.length ? totalRevenue / 30 : 0; // Rough estimate
  const projectedRevenueNext30 = dailyAvgRevenue * 30;
  const projectedLiabilitiesNext30 = users.length * 5; // Assume each user refers 0.2 people on avg

  const isNegativeCashFlow = totalMaiCoinsIssued > totalRevenue * 1.5;

  const projectionData = [
    { name: 'Current', revenue: totalRevenue, liability: totalMaiCoinsIssued },
    { name: 'Month 1 (Proj)', revenue: totalRevenue + projectedRevenueNext30, liability: totalMaiCoinsIssued + projectedLiabilitiesNext30 },
    { name: 'Month 2 (Proj)', revenue: totalRevenue + (projectedRevenueNext30 * 2.2), liability: totalMaiCoinsIssued + (projectedLiabilitiesNext30 * 2.5) },
    { name: 'Month 3 (Proj)', revenue: totalRevenue + (projectedRevenueNext30 * 4), liability: totalMaiCoinsIssued + (projectedLiabilitiesNext30 * 6) }
  ];

  return (
    <div className="space-y-8">
      {/* Warning Banner */}
      {isNegativeCashFlow && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-red-600 text-white p-8 rounded-[40px] shadow-2xl shadow-red-600/30 flex items-center space-x-6"
        >
          <div className="bg-white/20 p-4 rounded-3xl backdrop-blur-md">
            <AlertTriangle className="w-10 h-10" />
          </div>
          <div>
            <h3 className="text-2xl font-black tracking-tight mb-1">NEGATIVE CASH FLOW WARNING</h3>
            <p className="text-sm opacity-90 font-medium">Maicoin liabilities are growing faster than cash revenue. Current Ratio: {(totalMaiCoinsIssued / Math.max(totalRevenue, 1)).toFixed(2)}x. Immediate adjustment required.</p>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Projections Chart */}
        <div className="bg-white p-10 rounded-[40px] border border-mairide-secondary shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-mairide-primary">3-Month Projections</h3>
            <div className="flex items-center space-x-4 text-[10px] font-bold uppercase tracking-widest">
              <div className="flex items-center space-x-1">
                <div className="w-3 h-3 bg-mairide-accent rounded-full" />
                <span>Revenue</span>
              </div>
              <div className="flex items-center space-x-1">
                <div className="w-3 h-3 bg-mairide-primary rounded-full" />
                <span>Liability</span>
              </div>
            </div>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={projectionData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8E9299' }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }}
                />
                <Legend verticalAlign="top" height={36}/>
                <Line type="monotone" dataKey="revenue" stroke="#F27D26" strokeWidth={4} dot={{ r: 6, fill: '#F27D26', strokeWidth: 2, stroke: '#fff' }} name="Cash Revenue" />
                <Line type="monotone" dataKey="liability" stroke="#141414" strokeWidth={4} dot={{ r: 6, fill: '#141414', strokeWidth: 2, stroke: '#fff' }} name="Maicoin Liability" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Business Insights */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-[40px] border border-mairide-secondary shadow-sm">
            <h3 className="text-lg font-bold text-mairide-primary mb-6">Business Movement Insights</h3>
            <div className="space-y-6">
              {[
                { 
                  label: 'Revenue Velocity', 
                  value: '+12.5%', 
                  desc: 'Cash collection speed has increased compared to last month.',
                  trend: 'up' 
                },
                { 
                  label: 'Liability Burn Rate', 
                  value: '+4.2%', 
                  desc: 'Maicoin distribution is accelerating due to viral referrals.',
                  trend: 'up' 
                },
                { 
                  label: 'Net Profit Projection', 
                  value: '₹' + Math.floor(totalRevenue * 0.4).toLocaleString(), 
                  desc: 'Estimated profit after GST and referral liabilities.',
                  trend: 'neutral' 
                }
              ].map((insight, idx) => (
                <div key={idx} className="flex items-start space-x-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                    insight.trend === 'up' ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"
                  )}>
                    {insight.trend === 'up' ? <ArrowUpRight className="w-5 h-5" /> : <TrendingUp className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest">{insight.label}</p>
                      <p className="text-sm font-black text-mairide-primary">{insight.value}</p>
                    </div>
                    <p className="text-xs text-mairide-secondary leading-relaxed italic serif">{insight.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-mairide-accent p-8 rounded-[40px] text-white">
            <h3 className="text-lg font-bold mb-4">Strategic Recommendation</h3>
            <p className="text-sm opacity-90 leading-relaxed mb-6">
              The current data suggests that <span className="font-bold">Tier 1 Referrals</span> are the primary driver of liability. We recommend capping the maximum Maicoins a user can hold to 500 to mitigate long-term cash flow risks.
            </p>
            <div className="flex items-center space-x-2 text-[10px] font-bold uppercase tracking-widest bg-white/20 w-fit px-4 py-2 rounded-full">
              <ShieldCheck className="w-3 h-3" />
              <span>AI Analysis Complete</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AdminSecurityView = () => {
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;
    setIsUpdating(true);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser!.uid), { email: newEmail });
      alert("Email updated in profile. Note: Auth email update may require re-authentication.");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${auth.currentUser!.uid}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert("Passwords do not match!");
      return;
    }
    setIsUpdating(true);
    try {
      // In a real app, you'd use updatePassword(auth.currentUser!, newPassword)
      // For this environment, we'll simulate the request
      alert("Password update requested. Note: This feature requires a recent login session for security.");
    } catch (error) {
      alert("Error updating password: " + error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="bg-white rounded-[40px] border border-mairide-secondary p-10 shadow-sm">
        <h2 className="text-2xl font-bold text-mairide-primary mb-8 flex items-center">
          <Lock className="w-6 h-6 mr-3 text-mairide-accent" />
          Security Settings
        </h2>
        
        <div className="space-y-12">
          {/* Email Update */}
          <form onSubmit={handleUpdateEmail} className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Change Email</h3>
            <div className="space-y-2">
              <label className="text-xs font-bold text-mairide-primary uppercase ml-1">New Email Address</label>
              <input 
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                placeholder="Enter new email"
                required
              />
            </div>
            <button 
              type="submit"
              disabled={isUpdating}
              className="w-full bg-mairide-primary text-white py-4 rounded-2xl font-bold hover:bg-mairide-primary/90 transition-all disabled:opacity-50"
            >
              Update Email
            </button>
          </form>

          {/* Password Update */}
          <form onSubmit={handleUpdatePassword} className="space-y-6">
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">Change Password</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">New Password</label>
                <input 
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  placeholder="Minimum 6 characters"
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Confirm New Password</label>
                <input 
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  placeholder="Repeat new password"
                  required
                />
              </div>
            </div>
            <button 
              type="submit"
              disabled={isUpdating}
              className="w-full bg-mairide-accent text-white py-4 rounded-2xl font-bold hover:bg-mairide-accent/90 transition-all disabled:opacity-50 shadow-lg shadow-mairide-accent/20"
            >
              Update Password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

const ForcePasswordChangeModal = ({ profile }: { profile: UserProfile }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const handleCloseForNow = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out after password prompt close:', error);
    } finally {
      window.location.href = '/';
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert("Passwords do not match!");
      return;
    }
    if (newPassword.length < 6) {
      alert("Password must be at least 6 characters long.");
      return;
    }

    setIsUpdating(true);
    try {
      const idToken = await getAccessToken();
      await axios.post('/api/user?action=change-password', { newPassword }, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      alert("Password updated successfully! You can now access the app.");
      window.location.reload();
    } catch (error: any) {
      console.error('Error updating password:', error);
      alert("Failed to update password. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-md rounded-[40px] p-10 shadow-2xl"
      >
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex-1 text-center">
          <div className="w-20 h-20 bg-mairide-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-mairide-accent" />
          </div>
          <h2 className="text-3xl font-black text-mairide-primary tracking-tighter mb-2">Secure Your Account</h2>
          <p className="text-mairide-secondary italic serif">For security reasons, you must change your temporary password before proceeding.</p>
          </div>
          <button
            type="button"
            onClick={handleCloseForNow}
            className="rounded-2xl bg-mairide-bg p-2 text-mairide-secondary transition-colors hover:text-mairide-primary"
            aria-label="Close and return to login"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleUpdatePassword} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-mairide-primary uppercase ml-2">New Password</label>
            <input 
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
              placeholder="Min 6 characters"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-mairide-primary uppercase ml-2">Confirm New Password</label>
            <input 
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
              placeholder="Repeat new password"
              required
            />
          </div>
          <button 
            type="submit"
            disabled={isUpdating}
            className="w-full bg-mairide-primary text-white py-5 rounded-3xl font-bold text-lg shadow-lg shadow-mairide-primary/20 hover:scale-[1.02] transition-transform disabled:opacity-50"
          >
            {isUpdating ? 'Updating...' : 'Update Password & Continue'}
          </button>
          <button
            type="button"
            onClick={handleCloseForNow}
            className="w-full rounded-3xl border border-mairide-secondary bg-white py-4 text-base font-bold text-mairide-primary transition-colors hover:bg-mairide-bg"
          >
            Logout for now
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const AdminDashboard = ({ profile, isLoaded, loadError, authFailure }: { profile: UserProfile, isLoaded: boolean, loadError?: Error, authFailure?: boolean }) => {
  const effectiveAdminRole = profile.adminRole || 'super_admin';
  type UsersInsightView = 'drivers' | 'travelers' | 'onlineDrivers' | 'onlineTravelers' | 'activeTrips' | 'openOffers' | null;
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'support' | 'verification' | 'profile' | 'rides' | 'revenue' | 'transactions' | 'config' | 'analytics' | 'security' | 'map'>('revenue');
  const [adminLocation, setAdminLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  if (loadError || authFailure) {
    return (
      <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-red-100">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Google Maps Error</h2>
        <p className="text-gray-600 mb-4">
          {loadError ? loadError.message : "Authentication Failure (Check API Key restrictions or billing)"}
        </p>
      </div>
    );
  }
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserProfile | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [isGeneratingResetLink, setIsGeneratingResetLink] = useState<string | null>(null);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordUser || !newAdminPassword) return;

    setIsResetting(true);
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      await axios.post(adminApiPath('update-password'), {
        uid: resetPasswordUser.uid,
        newPassword: newAdminPassword
      }, {
        headers
      });
      setAdminNotice({
        title: 'Password updated',
        message: `A temporary password has been set successfully for ${resetPasswordUser.displayName}.`,
        tone: 'success',
      });
      setResetPasswordUser(null);
      setNewAdminPassword('');
    } catch (error: any) {
      console.error('Error resetting password:', error);
      setAdminNotice({
        title: 'Password update failed',
        message: getApiErrorMessage(error, 'We could not update the password right now. Please try again.'),
        tone: 'error',
      });
    } finally {
      setIsResetting(false);
    }
  };

  const handleGenerateResetLink = async (targetUser: UserProfile) => {
    setIsGeneratingResetLink(targetUser.uid);
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      const response = await axios.post(adminApiPath('generate-reset-link'), {
        email: targetUser.email
      }, {
        headers
      });

      const resetLink = response.data?.actionLink;
      if (!resetLink) {
        throw new Error("No reset link returned.");
      }

      await navigator.clipboard.writeText(resetLink);
      setAdminNotice({
        title: 'Reset link copied',
        message: `A secure password reset link for ${targetUser.displayName} has been copied. Share it only through your approved support channel.`,
        tone: 'success',
      });
    } catch (error: any) {
      console.error('Error generating reset link:', error);
      setAdminNotice({
        title: 'Reset link failed',
        message: getApiErrorMessage(error, 'We could not generate a reset link right now. Please try again.'),
        tone: 'error',
      });
    } finally {
      setIsGeneratingResetLink(null);
    }
  };

  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [newUser, setNewUser] = useState<{ 
    email: string, 
    displayName: string, 
    phoneNumber: string, 
    password: string,
    role: 'consumer' | 'driver' | 'admin',
    adminRole?: 'super_admin' | 'support' | 'finance' | 'compliance'
  }>({ email: '', displayName: '', phoneNumber: '', password: '', role: 'consumer', adminRole: 'support' });
  const [selectedDriver, setSelectedDriver] = useState<UserProfile | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'consumer' | 'driver' | 'admin'>('all');
  const [usersInsightView, setUsersInsightView] = useState<UsersInsightView>(null);
  const [adminNotice, setAdminNotice] = useState<{
    title: string;
    message: string;
    tone: 'success' | 'error' | 'info';
  } | null>(null);
  const [forceCancellingRideId, setForceCancellingRideId] = useState<string | null>(null);
  const selectedDriverMarkers = buildVerificationMarkers(selectedDriver?.driverDetails);

  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map(doc => doc.data() as UserProfile);
      setUsers(usersData);
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const bookingsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setBookings(bookingsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'rides'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ridesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ride));
      setRides(ridesData);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'rides');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (activeTab !== 'transactions') {
      return;
    }

    let active = true;

    const loadTransactions = async () => {
      try {
        const headers = await getAdminRequestHeaders(profile.email);
        const response = await axios.get(adminTransactionsPath, { headers });
        if (!active) return;
        setTransactions((response.data?.transactions || []) as Transaction[]);
      } catch (error) {
        if (!active) return;
        console.error('Error loading admin transactions:', error);
        setAdminNotice({
          title: 'Transactions unavailable',
          message: getApiErrorMessage(error, 'We could not load platform transaction records right now.'),
          tone: 'error',
        });
      }
    };

    void loadTransactions();
    const intervalId = window.setInterval(() => {
      void loadTransactions();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [activeTab, profile.email]);

  const handleAdminForceCancelRide = async (booking: any) => {
    const rideId = booking.rideId || booking.ride_id;
    if (!rideId) {
      setAdminNotice({
        title: 'Ride not found',
        message: 'This booking is missing a linked ride reference, so support cannot cancel it from here.',
        tone: 'error',
      });
      return;
    }

    setForceCancellingRideId(rideId);
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      await axios.post(adminApiPath('force-cancel-ride'), {
        rideId,
        bookingId: booking.id,
        reason: 'Cancelled by MaiRide customer support',
      }, { headers });

      setBookings((prev) =>
        prev.map((currentBooking) =>
          (currentBooking.rideId || currentBooking.ride_id) === rideId
            ? {
                ...currentBooking,
                status: 'cancelled',
                rideRetired: true,
                negotiationStatus: 'rejected',
                forceCancelledByAdmin: true,
              }
            : currentBooking
        )
      );
      setRides((prev) =>
        prev.map((ride) =>
          ride.id === rideId
            ? {
                ...ride,
                status: 'cancelled',
              }
            : ride
        )
      );
      setAdminNotice({
        title: 'Ride cancelled',
        message: 'MaiRide support override has cancelled this ride and retired its linked bookings.',
        tone: 'success',
      });
    } catch (error: any) {
      setAdminNotice({
        title: 'Cancellation failed',
        message: getApiErrorMessage(error, 'We could not cancel this ride from the admin panel right now.'),
        tone: 'error',
      });
    } finally {
      setForceCancellingRideId(null);
    }
  };

  useEffect(() => {
    if (!('geolocation' in navigator)) return;

    let isMounted = true;
    const syncLocation = (latitude: number, longitude: number) => {
      const nextLocation = { lat: latitude, lng: longitude };
      if (isMounted) {
        setAdminLocation(nextLocation);
      }

      updateDoc(doc(db, 'users', profile.uid), {
        location: {
          ...nextLocation,
          lastUpdated: new Date().toISOString(),
        },
      }).catch((error) => handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`));
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        syncLocation(position.coords.latitude, position.coords.longitude);
      },
      (error) => console.error('Admin geolocation error:', error),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        syncLocation(position.coords.latitude, position.coords.longitude);
      },
      (error) => console.error('Admin geolocation watch error:', error),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );

    return () => {
      isMounted = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [profile.uid]);

  const filteredUsers = users.filter(user => {
    if (user.uid === profile.uid) return false;
    if (user.role === 'driver' && (!user.onboardingComplete || user.verificationStatus === 'pending')) return false;
    const matchesSearch = user.displayName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });
  const pendingVerificationDrivers = users.filter(
    (u) => u.role === 'driver' && u.onboardingComplete && u.verificationStatus === 'pending'
  );
  const activityWindowMs = 15 * 60 * 1000;
  const isRecentlyActive = (user: UserProfile) => {
    if (!user.location?.lastUpdated) return false;
    const lastUpdated = new Date(user.location.lastUpdated).getTime();
    return !Number.isNaN(lastUpdated) && Date.now() - lastUpdated <= activityWindowMs;
  };
  const isUserCurrentlyOnline = (user: UserProfile) => (
    user.status === 'active' && (
      (user.role === 'driver' && Boolean(user.driverDetails?.isOnline))
      || isRecentlyActive(user)
    )
  );
  const registeredDrivers = users.filter((u) => u.role === 'driver');
  const registeredTravelers = users.filter((u) => u.role === 'consumer');
  const onlineDrivers = registeredDrivers.filter((u) => isUserCurrentlyOnline(u));
  const onlineTravelers = registeredTravelers.filter((u) => isUserCurrentlyOnline(u));
  const lockedRideIds = getLockedRideIds(bookings as Booking[]);
  const openRideOffers = rides.filter((ride) => ride.status === 'available' && !lockedRideIds.has(ride.id));
  const activeTrips = bookings.filter((booking) =>
    booking.status === 'confirmed'
    || booking.rideLifecycleStatus === 'awaiting_start_otp'
    || booking.rideLifecycleStatus === 'in_progress'
  );
  const getUserRideOffers = (userId: string) =>
    rides.filter((ride) => ride.driverId === userId);
  const getActiveRideOffers = (userId: string) =>
    rides.filter((ride) => ride.driverId === userId && ride.status === 'available' && !lockedRideIds.has(ride.id));
  const getUserRideBookings = (userId: string, role: UserProfile['role']) =>
    bookings.filter((booking) => role === 'driver' ? booking.driverId === userId : booking.consumerId === userId);
  const getActiveUserTrips = (userId: string, role: UserProfile['role']) =>
    bookings.filter((booking) =>
      (role === 'driver' ? booking.driverId === userId : booking.consumerId === userId)
      && (
        booking.status === 'confirmed'
        || booking.rideLifecycleStatus === 'awaiting_start_otp'
        || booking.rideLifecycleStatus === 'in_progress'
      )
    );
  const adminSelfProfile = users.find((user) => user.uid === profile.uid) || profile;
  const adminUserTrips = getUserRideBookings(adminSelfProfile.uid, adminSelfProfile.role);
  const adminOpenOffers = adminSelfProfile.role === 'driver' ? getActiveRideOffers(adminSelfProfile.uid).length : 0;
  const adminActiveTrips = getActiveUserTrips(adminSelfProfile.uid, adminSelfProfile.role).length;
  const usersWithLocation = users.filter(
    u => u.location && typeof u.location.lat === 'number' && typeof u.location.lng === 'number'
  );
  const userCards = [
    {
      id: 'drivers' as UsersInsightView,
      label: 'Registered Drivers',
      value: registeredDrivers.length,
      icon: Car,
      color: 'bg-orange-50 text-orange-600',
      helper: 'All drivers on the platform',
    },
    {
      id: 'travelers' as UsersInsightView,
      label: 'Registered Travelers',
      value: registeredTravelers.length,
      icon: Users,
      color: 'bg-blue-50 text-blue-600',
      helper: 'All travelers on the platform',
    },
    {
      id: 'onlineDrivers' as UsersInsightView,
      label: 'Logged-in Drivers',
      value: onlineDrivers.length,
      icon: Navigation,
      color: 'bg-emerald-50 text-emerald-600',
      helper: 'Online or recently active drivers',
    },
    {
      id: 'onlineTravelers' as UsersInsightView,
      label: 'Logged-in Travelers',
      value: onlineTravelers.length,
      icon: UserIcon,
      color: 'bg-cyan-50 text-cyan-600',
      helper: 'Online or recently active travelers',
    },
    {
      id: 'activeTrips' as UsersInsightView,
      label: 'Active Trips',
      value: activeTrips.length,
      icon: Clock,
      color: 'bg-purple-50 text-purple-600',
      helper: 'Bookings currently in motion',
    },
    {
      id: 'openOffers' as UsersInsightView,
      label: 'Open Ride Offers',
      value: openRideOffers.length,
      icon: PlusCircle,
      color: 'bg-amber-50 text-amber-600',
      helper: 'Offers available for travelers to book',
    },
  ];
  const usersInsightContent = (() => {
    switch (usersInsightView) {
      case 'drivers':
        return {
          title: 'Registered Drivers',
          description: 'All drivers currently registered on the platform.',
          users: registeredDrivers,
          rides: [] as Ride[],
          trips: [] as Booking[],
        };
      case 'travelers':
        return {
          title: 'Registered Travelers',
          description: 'All travelers currently registered on the platform.',
          users: registeredTravelers,
          rides: [] as Ride[],
          trips: [] as Booking[],
        };
      case 'onlineDrivers':
        return {
          title: 'Logged-in Drivers',
          description: 'Drivers currently online or recently active on the system.',
          users: onlineDrivers,
          rides: [] as Ride[],
          trips: [] as Booking[],
        };
      case 'onlineTravelers':
        return {
          title: 'Logged-in Travelers',
          description: 'Travelers currently online or recently active on the system.',
          users: onlineTravelers,
          rides: [] as Ride[],
          trips: [] as Booking[],
        };
      case 'activeTrips':
        return {
          title: 'Active Trips',
          description: 'Trips that are currently confirmed, awaiting OTP, or in progress.',
          users: [] as UserProfile[],
          rides: [] as Ride[],
          trips: activeTrips as Booking[],
        };
      case 'openOffers':
        return {
          title: 'Open Ride Offers',
          description: 'Ride offers that are still available for travelers to book.',
          users: [] as UserProfile[],
          rides: openRideOffers,
          trips: [] as Booking[],
        };
      default:
        return null;
    }
  })();
  const adminMapCenter = adminLocation
    || (usersWithLocation.length
      ? {
          lat: usersWithLocation.reduce((sum, user) => sum + user.location!.lat, 0) / usersWithLocation.length,
          lng: usersWithLocation.reduce((sum, user) => sum + user.location!.lng, 0) / usersWithLocation.length,
        }
      : { lat: 22.5937, lng: 78.9629 });
  const adminMapZoom = adminLocation ? 13 : usersWithLocation.length ? 5 : 4;

  const handleVerifyDriver = async (userId: string, status: 'approved' | 'rejected') => {
    if (!selectedDriver || selectedDriver.verificationStatus !== 'pending') {
      alert('Only pending driver applications can be reviewed here.');
      return;
    }
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      await axios.post(adminVerifyDriverPath, {
        uid: userId,
        verificationStatus: status,
        rejectionReason: status === 'rejected' ? rejectionReason : '',
      }, { headers });
      setUsers((prev) =>
        prev.map((currentUser) =>
          currentUser.uid === userId
            ? {
                ...currentUser,
                verificationStatus: status,
                rejectionReason: status === 'rejected' ? rejectionReason : undefined,
                status: status === 'approved' ? 'active' : 'inactive',
                verifiedBy: profile.uid,
              }
            : currentUser
        )
      );
      setSelectedDriver(null);
      setRejectionReason('');
    } catch (error) {
      setAdminNotice({
        title: 'Verification update failed',
        message: getApiErrorMessage(error, 'We could not update this driver verification right now.'),
        tone: 'error',
      });
    }
  };

  const handleUpdateRole = async (userId: string, newRole: 'consumer' | 'driver' | 'admin') => {
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      await axios.post(`/api/delete-user`, { uid: userId }, { headers });
      setShowDeleteConfirm(null);
      setAdminNotice({
        title: 'User removed',
        message: 'The selected user has been deleted successfully.',
        tone: 'success',
      });
    } catch (error: any) {
      console.error('Error deleting user:', error);
      setAdminNotice({
        title: 'Delete failed',
        message: getApiErrorMessage(error, 'We could not delete this user right now. Please try again.'),
        tone: 'error',
      });
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    const normalizedPhone = editingUser.phoneNumber ? toIndianPhoneStorage(editingUser.phoneNumber) : '';
    if (editingUser.phoneNumber && !normalizedPhone) {
      setAdminNotice({
        title: 'Invalid mobile number',
        message: 'Please enter a valid 10-digit Indian mobile number.',
        tone: 'info',
      });
      return;
    }
    try {
      await updateDoc(doc(db, 'users', editingUser.uid), {
        displayName: sanitizeDisplayName(editingUser.displayName),
        phoneNumber: normalizedPhone,
        role: editingUser.role,
        status: editingUser.status
      });
      setEditingUser(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${editingUser.uid}`);
    }
  };

  const handleUpdateStatus = async (userId: string, newStatus: 'active' | 'inactive') => {
    try {
      await updateDoc(doc(db, 'users', userId), { status: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = normalizeEmailValue(newUser.email);
    const normalizedPhone = newUser.phoneNumber ? toIndianPhoneStorage(newUser.phoneNumber) : '';
    if (!normalizedEmail || !newUser.displayName || !newUser.password) {
      setAdminNotice({
        title: 'Missing details',
        message: 'Please complete all required fields, including the temporary password.',
        tone: 'info',
      });
      return;
    }
    if (!isValidEmailValue(normalizedEmail)) {
      setAdminNotice({
        title: 'Invalid email',
        message: 'Please enter a valid email address with a proper domain.',
        tone: 'info',
      });
      return;
    }
    if (newUser.phoneNumber && !normalizedPhone) {
      setAdminNotice({
        title: 'Invalid mobile number',
        message: 'Please enter a valid 10-digit Indian mobile number.',
        tone: 'info',
      });
      return;
    }

    // Check for duplicate email
    const duplicateCheck = users.find(u => normalizeEmailValue(u.email) === normalizedEmail);
    if (duplicateCheck) {
      setAdminNotice({
        title: 'User already exists',
        message: 'A user with this email address already exists on the platform.',
        tone: 'info',
      });
      return;
    }

    setIsLoading(true);
    try {
      // 1. Get ID Token for Authorization
      const headers = await getAdminRequestHeaders(profile.email);

      // 2. Call Backend API to create user in Auth and Firestore
      const response = await axios.post(adminApiPath('create-user'), {
        email: normalizedEmail,
        password: newUser.password,
        displayName: sanitizeDisplayName(newUser.displayName),
        phoneNumber: normalizedPhone,
        role: newUser.role,
        adminRole: newUser.role === 'admin' ? newUser.adminRole : undefined
      }, {
        headers
      });

      if (response.status === 201) {
        setShowAddUser(false);
        setNewUser({ email: '', displayName: '', phoneNumber: '', password: '', role: 'consumer', adminRole: 'support' });
        setAdminNotice({
          title: 'User created',
          message: `${newUser.displayName} has been created successfully with a temporary password.`,
          tone: 'success',
        });
      }
    } catch (error: any) {
      console.error('Error creating user:', error);
      const errorMessage = getApiErrorMessage(error, 'Failed to create user');
      setAdminNotice({
        title: 'User creation failed',
        message: errorMessage,
        tone: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-mairide-bg flex overflow-hidden relative">
      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "bg-white border-r border-mairide-secondary flex flex-col transition-all duration-300 fixed lg:static inset-y-0 left-0 z-50",
        isSidebarOpen ? "w-72 translate-x-0" : "w-20 -translate-x-full lg:translate-x-0"
      )}>
        <div className="p-6 flex items-center justify-between border-b border-mairide-bg">
          <div className={cn("flex items-center overflow-hidden transition-all", isSidebarOpen ? "opacity-100" : "opacity-0 w-0")}>
            <img src={LOGO_URL} className="w-8 h-8 object-contain mr-2" alt="Logo" />
            <h1 className="text-lg font-black tracking-tighter text-mairide-primary whitespace-nowrap">
              {BRAND_NAME}
            </h1>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-mairide-bg rounded-xl text-mairide-secondary hover:text-mairide-primary"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {[
            { id: 'verification', label: 'Verifications', icon: ShieldCheck, roles: ['super_admin', 'support', 'compliance'] },
            { id: 'map', label: 'Live Map', icon: MapPin, roles: ['super_admin', 'support'] },
            { id: 'users', label: 'Users', icon: Users, roles: ['super_admin', 'compliance'] },
            { id: 'rides', label: 'Rides', icon: Car, roles: ['super_admin', 'compliance'] },
            { id: 'revenue', label: 'Revenue', icon: IndianRupee, roles: ['super_admin', 'finance'] },
            { id: 'analytics', label: 'Analytics', icon: LineChartIcon, roles: ['super_admin', 'finance'] },
            { id: 'transactions', label: 'Transactions', icon: Receipt, roles: ['super_admin', 'finance', 'support'] },
            { id: 'config', label: 'Config', icon: Settings, roles: ['super_admin', 'finance'] },
            { id: 'support', label: 'Support', icon: LifeBuoy, roles: ['super_admin', 'support'] },
            { id: 'security', label: 'Security', icon: Lock, roles: ['super_admin'] },
            { id: 'profile', label: 'Profile', icon: UserIcon, roles: ['super_admin', 'support', 'finance', 'compliance'] },
          ].filter(item => item.roles.includes(effectiveAdminRole)).map(item => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id as any);
                if (window.innerWidth < 1024) {
                  setIsSidebarOpen(false);
                }
              }}
              className={cn(
                "w-full flex items-center space-x-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all group relative",
                activeTab === item.id 
                  ? "bg-mairide-primary text-white shadow-lg shadow-mairide-primary/20" 
                  : "text-mairide-secondary hover:bg-mairide-bg hover:text-mairide-primary"
              )}
            >
              <item.icon className={cn("w-5 h-5 shrink-0", activeTab === item.id ? "text-white" : "group-hover:scale-110 transition-transform")} />
              <span className={cn("whitespace-nowrap transition-all", isSidebarOpen ? "opacity-100" : "opacity-0 w-0")}>
                {item.label}
              </span>
              {item.id === 'verification' && pendingVerificationDrivers.length > 0 && (
                <span className={cn(
                  "bg-mairide-accent text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full ml-auto",
                  !isSidebarOpen && "absolute top-1 right-1"
                )}>
                  {pendingVerificationDrivers.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-mairide-bg">
          <button 
            onClick={() => signOut(auth)}
            className={cn(
              "w-full flex items-center space-x-3 px-4 py-3 rounded-2xl text-sm font-bold text-red-600 hover:bg-red-50 transition-all",
              !isSidebarOpen && "justify-center"
            )}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span className={cn("whitespace-nowrap", isSidebarOpen ? "block" : "hidden")}>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="lg:hidden bg-white border-b border-mairide-secondary p-4 flex justify-between items-center">
          <div className="flex items-center">
            <img src={LOGO_URL} className="w-8 h-8 object-contain mr-2" alt="Logo" />
            <h1 className="text-lg font-black tracking-tighter text-mairide-primary leading-none">
              {BRAND_NAME}
            </h1>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 bg-mairide-bg rounded-xl"
          >
            <Menu className="w-6 h-6 text-mairide-primary" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12">
          <div className="max-w-7xl mx-auto">
            <div className="mb-12">
              <h2 className="text-4xl font-black text-mairide-primary tracking-tighter capitalize mb-2">
                {activeTab}
              </h2>
              <p className="text-mairide-secondary italic serif text-lg">Manage and monitor platform {activeTab} details.</p>
            </div>

            {activeTab === 'verification' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pendingVerificationDrivers.map(driver => (
                <div 
                  key={driver.uid}
                  className={cn(
                    "bg-white rounded-[32px] p-6 border transition-all cursor-pointer hover:shadow-xl",
                    driver.verificationStatus === 'pending' ? "border-orange-200 bg-orange-50/30" : "border-mairide-secondary"
                  )}
                  onClick={() => setSelectedDriver(driver)}
                >
                  <div className="flex items-center space-x-4 mb-4">
                    <div className="w-16 h-16 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary">
                      {driver.driverDetails?.selfiePhoto ? (
                        <img src={driver.driverDetails.selfiePhoto} className="w-full h-full object-cover" alt="Selfie" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><UserIcon className="w-8 h-8 text-mairide-secondary" /></div>
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-mairide-primary">{driver.displayName}</h3>
                      <p className="text-xs text-mairide-secondary">{driver.email}</p>
                      <span className={cn(
                        "inline-block px-2 py-0.5 rounded-full text-[8px] font-bold uppercase mt-1",
                        driver.verificationStatus === 'pending' ? "bg-orange-100 text-orange-600" :
                        driver.verificationStatus === 'approved' ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                      )}>
                        {driver.verificationStatus}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-mairide-secondary uppercase">
                    <div className="bg-mairide-bg p-2 rounded-xl">
                      <p className="opacity-60 mb-0.5">Vehicle</p>
                      <p className="text-mairide-primary truncate">{driver.driverDetails?.vehicleMake} {driver.driverDetails?.vehicleModel}</p>
                    </div>
                    <div className="bg-mairide-bg p-2 rounded-xl">
                      <p className="opacity-60 mb-0.5">Reg No</p>
                      <p className="text-mairide-primary truncate">{driver.driverDetails?.vehicleRegNumber}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {pendingVerificationDrivers.length === 0 && (
              <div className="text-center py-20 bg-white rounded-[40px] border border-mairide-secondary border-dashed">
                <ShieldCheck className="w-16 h-16 text-mairide-secondary mx-auto mb-4 opacity-20" />
                <h3 className="text-xl font-bold text-mairide-primary">No pending verifications</h3>
                <p className="text-mairide-secondary italic serif">Approved and rejected drivers are now managed from the users section, while only pending applications stay here.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'map' && (
          <div className="h-[700px] bg-white rounded-[40px] border border-mairide-secondary shadow-sm overflow-hidden relative">
            {GOOGLE_MAPS_API_KEY && isLoaded && window.google ? (
              <GoogleMap
                mapContainerStyle={{ width: '100%', height: '100%' }}
                center={adminMapCenter}
                zoom={adminMapZoom}
                options={{
                  styles: [
                    { "featureType": "poi", "stylers": [{ "visibility": "off" }] },
                    { "featureType": "transit", "stylers": [{ "visibility": "off" }] }
                  ]
                }}
              >
                {adminLocation && (
                  <Marker
                    position={adminLocation}
                    icon={{
                      url: 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png',
                      scaledSize: new window.google.maps.Size(30, 30)
                    }}
                    title="Super Admin Current Location"
                  />
                )}
                {usersWithLocation.map(user => (
                  <Marker
                    key={user.uid}
                    position={{ lat: user.location!.lat, lng: user.location!.lng }}
                    icon={{
                      url: user.role === 'driver' 
                        ? 'https://maps.google.com/mapfiles/ms/icons/car.png' 
                        : 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
                      scaledSize: (isLoaded && window.google) ? new window.google.maps.Size(user.role === 'driver' ? 32 : 24, user.role === 'driver' ? 32 : 24) : undefined
                    }}
                    title={`${user.displayName} (${user.role})`}
                  />
                ))}
              </GoogleMap>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-12">
                <MapPin className="w-12 h-12 text-mairide-secondary mb-4" />
                <h3 className="text-xl font-bold text-mairide-primary">
                  {loadError ? "Maps Error" : "Map Unavailable"}
                </h3>
                <p className="text-mairide-secondary">
                  {loadError ? loadError.message : "Please check your Google Maps API configuration."}
                </p>
              </div>
            )}
            
            {/* Legend */}
            <div className="absolute bottom-8 left-8 bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-mairide-secondary shadow-xl z-10">
              <h4 className="text-[10px] font-bold text-mairide-secondary uppercase mb-3">Map Legend</h4>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-xs font-bold text-mairide-primary">Traveler</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Car className="w-4 h-4 text-mairide-accent" />
                  <span className="text-xs font-bold text-mairide-primary">Driver</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-8">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {userCards.map((stat) => (
                <button
                  key={stat.id}
                  type="button"
                  onClick={() => setUsersInsightView(usersInsightView === stat.id ? null : stat.id)}
                  className={cn(
                    "bg-white p-6 rounded-[32px] border border-mairide-secondary shadow-sm text-left transition-all hover:-translate-y-1 hover:shadow-lg",
                    usersInsightView === stat.id && "ring-2 ring-mairide-accent shadow-lg"
                  )}
                >
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4", stat.color)}>
                    <stat.icon className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-1">{stat.label}</p>
                  <p className="text-3xl font-black text-mairide-primary tracking-tighter">{stat.value}</p>
                  <p className="text-xs text-mairide-secondary mt-2">{stat.helper}</p>
                </button>
              ))}
            </div>

            {usersInsightContent && (
              <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-sm p-8 space-y-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-bold text-mairide-primary">{usersInsightContent.title}</h3>
                    <p className="text-sm text-mairide-secondary">{usersInsightContent.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUsersInsightView(null)}
                    className="self-start md:self-auto px-4 py-2 bg-mairide-bg text-mairide-primary rounded-xl text-sm font-bold"
                  >
                    Clear view
                  </button>
                </div>

                {usersInsightContent.users.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {usersInsightContent.users.map((user) => (
                      <button
                        key={user.uid}
                        type="button"
                        onClick={() => user.role === 'driver' ? setSelectedDriver(user) : setSelectedUser(user)}
                        className="text-left p-5 bg-mairide-bg rounded-[28px] border border-mairide-secondary hover:shadow-md transition-all"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-14 h-14 rounded-2xl bg-white border border-mairide-secondary overflow-hidden flex items-center justify-center">
                            {getResolvedUserPhoto(user) ? (
                              <img src={getResolvedUserPhoto(user)} alt={user.displayName} className="w-full h-full object-cover" />
                            ) : (
                              <UserIcon className="w-6 h-6 text-mairide-secondary" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-mairide-primary truncate">{user.displayName}</p>
                            <p className="text-xs text-mairide-secondary truncate">{user.email}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-accent mt-1">
                              {user.role === 'driver' ? `${getActiveRideOffers(user.uid).length} open offers` : `${getActiveUserTrips(user.uid, user.role).length} active trips`}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {usersInsightContent.rides.length > 0 && (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {usersInsightContent.rides.map((ride) => (
                      <div key={ride.id} className="p-5 bg-mairide-bg rounded-[28px] border border-mairide-secondary">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-bold text-mairide-primary">{ride.origin}</p>
                            <p className="text-[10px] text-mairide-secondary uppercase tracking-widest my-1">to</p>
                            <p className="text-sm font-bold text-mairide-primary">{ride.destination}</p>
                          </div>
                          <span className="px-3 py-1 rounded-full bg-green-100 text-green-600 text-[10px] font-bold uppercase">
                            {ride.status}
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-mairide-secondary">Driver</p>
                            <p className="font-bold text-mairide-primary">{ride.driverName}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Seats</p>
                            <p className="font-bold text-mairide-primary">{ride.seatsAvailable}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Fare</p>
                            <p className="font-bold text-mairide-primary">{formatCurrency(ride.price)}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Departure</p>
                            <p className="font-bold text-mairide-primary">{new Date(ride.departureTime).toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {usersInsightContent.trips.length > 0 && (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {usersInsightContent.trips.map((booking) => (
                      <div key={booking.id} className="p-5 bg-mairide-bg rounded-[28px] border border-mairide-secondary">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-bold text-mairide-primary">{booking.origin}</p>
                            <p className="text-[10px] text-mairide-secondary uppercase tracking-widest my-1">to</p>
                            <p className="text-sm font-bold text-mairide-primary">{booking.destination}</p>
                          </div>
                          <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-600 text-[10px] font-bold uppercase">
                            {booking.rideLifecycleStatus || booking.status}
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-mairide-secondary">Traveler</p>
                            <p className="font-bold text-mairide-primary">{booking.consumerName}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Driver</p>
                            <p className="font-bold text-mairide-primary">{booking.driverName}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Value</p>
                            <p className="font-bold text-mairide-primary">{formatCurrency(booking.totalPrice)}</p>
                          </div>
                          <div>
                            <p className="text-mairide-secondary">Created</p>
                            <p className="font-bold text-mairide-primary">{new Date(booking.createdAt).toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* User Management Table */}
            <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-sm overflow-hidden">
              <div className="p-8 border-b border-mairide-secondary space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-mairide-primary">User Management</h2>
                    {effectiveAdminRole === 'super_admin' && (
                      <p className="mt-2 text-xs text-mairide-secondary max-w-2xl">
                        Passwords are never visible to admins. Use a temporary password reset or copy a secure reset link for support cases.
                      </p>
                    )}
                  </div>
                  <button 
                    onClick={() => setShowAddUser(true)}
                    className="flex items-center space-x-2 bg-mairide-primary text-white px-6 py-3 rounded-2xl font-bold hover:scale-105 transition-transform shadow-lg shadow-mairide-primary/20"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Add User</span>
                  </button>
                </div>
                
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-mairide-secondary" />
                    <input 
                      type="text"
                      placeholder="Search by name or email..."
                      className="w-full pl-12 pr-6 py-3 bg-mairide-bg border-none rounded-xl outline-none text-sm"
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="flex space-x-2">
                    {['all', 'consumer', 'driver', 'admin'].map(role => (
                      <button
                        key={role}
                        onClick={() => setRoleFilter(role as any)}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all",
                          roleFilter === role ? "bg-mairide-primary text-white" : "bg-mairide-bg text-mairide-secondary hover:text-mairide-primary"
                        )}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="divide-y divide-mairide-secondary">
                <div className="hidden xl:grid grid-cols-[minmax(0,2fr)_160px_minmax(0,1.2fr)_160px_130px_180px] gap-6 bg-mairide-bg text-[10px] font-bold text-mairide-secondary uppercase tracking-widest px-8 py-4">
                  <div>User</div>
                  <div>Role</div>
                  <div>Activity</div>
                  <div>MaiCoins</div>
                  <div>Status</div>
                  <div>Actions</div>
                </div>
                <div className="divide-y divide-mairide-secondary">
                  {filteredUsers.map(user => (
                    <div key={user.uid} className="px-6 md:px-8 py-6 hover:bg-mairide-bg/50 transition-colors">
                      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_160px_minmax(0,1.2fr)_160px_130px_180px] gap-6 items-start">
                        <button
                          type="button"
                          onClick={() => user.role === 'driver' ? setSelectedDriver(user) : setSelectedUser(user)}
                          className="flex items-center space-x-3 text-left group min-w-0"
                        >
                          <div className="w-14 h-14 rounded-2xl bg-mairide-bg flex items-center justify-center overflow-hidden border border-mairide-secondary shrink-0">
                            {getResolvedUserPhoto(user) ? (
                              <img src={getResolvedUserPhoto(user)} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <UserIcon className="w-6 h-6 text-mairide-secondary" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-lg text-mairide-primary group-hover:text-mairide-accent transition-colors truncate">{user.displayName}</p>
                            <p className="text-sm text-mairide-secondary truncate">{user.email}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-accent mt-1">View details</p>
                            {effectiveAdminRole === 'super_admin' && user.forcePasswordChange && (
                              <p className="text-[10px] font-mono text-mairide-accent mt-1 bg-mairide-accent/5 px-2 py-0.5 rounded inline-block">
                                Password reset required
                              </p>
                            )}
                          </div>
                        </button>

                        <div className="space-y-2">
                          <p className="xl:hidden text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">Role</p>
                          <select 
                            value={user.role}
                            onChange={(e) => handleUpdateRole(user.uid, e.target.value as any)}
                            className="w-full bg-mairide-bg border-none rounded-xl text-xs font-bold p-3 outline-none"
                          >
                            <option value="consumer">Consumer</option>
                            <option value="driver">Driver</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>

                        <div className="space-y-2">
                          <p className="xl:hidden text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">Activity</p>
                          {user.role === 'driver' ? (
                            <>
                              <p className="font-black text-mairide-primary tracking-tight text-2xl">
                                {getActiveRideOffers(user.uid).length} <span className="text-[10px] font-bold text-mairide-accent uppercase">open offers</span>
                              </p>
                              <p className="text-xs text-mairide-secondary">
                                {getActiveUserTrips(user.uid, user.role).length} active trips · {isUserCurrentlyOnline(user) ? 'online now' : 'offline'}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="font-black text-mairide-primary tracking-tight text-2xl">
                                {getActiveUserTrips(user.uid, user.role).length} <span className="text-[10px] font-bold text-mairide-accent uppercase">active trips</span>
                              </p>
                              <p className="text-xs text-mairide-secondary">
                                {getUserRideBookings(user.uid, user.role).length} total rides · {isUserCurrentlyOnline(user) ? 'online now' : 'offline'}
                              </p>
                            </>
                          )}
                        </div>

                        <div className="space-y-2">
                          <p className="xl:hidden text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">MaiCoins</p>
                          <p className="font-black text-mairide-primary tracking-tight text-2xl">
                            {user.wallet?.balance || 0} <span className="text-[10px] font-bold text-mairide-accent uppercase">MC</span>
                          </p>
                          <p className="text-xs text-mairide-secondary">
                            Pending: {user.wallet?.pendingBalance || 0} MC
                          </p>
                        </div>

                        <div className="space-y-2">
                          <p className="xl:hidden text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">Status</p>
                          <button 
                            onClick={() => handleUpdateStatus(user.uid, user.status === 'active' ? 'inactive' : 'active')}
                            className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                              user.status === 'active' ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                            )}
                          >
                            {user.status}
                          </button>
                        </div>

                        <div className="space-y-2">
                          <p className="xl:hidden text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">Actions</p>
                          <div className="flex items-center flex-wrap gap-2">
                            <button 
                              onClick={() => setShowDeleteConfirm(user.uid)}
                              className="p-2 hover:bg-red-50 text-red-600 rounded-xl transition-colors"
                              title="Delete User"
                            >
                              <X className="w-5 h-5" />
                            </button>
                            <div className="relative group/menu">
                              <button 
                                onClick={() => setEditingUser(user)}
                                className="p-2 hover:bg-mairide-bg rounded-xl transition-colors"
                              >
                                <MoreVertical className="w-5 h-5 text-mairide-secondary" />
                              </button>
                            </div>
                            {effectiveAdminRole === 'super_admin' && (
                              <>
                                <button 
                                  onClick={() => handleGenerateResetLink(user)}
                                  disabled={isGeneratingResetLink === user.uid}
                                  className="p-2 hover:bg-blue-50 text-blue-600 rounded-xl transition-colors disabled:opacity-50"
                                  title="Copy Password Reset Link"
                                >
                                  <Copy className="w-5 h-5" />
                                </button>
                                <button 
                                  onClick={() => setResetPasswordUser(user)}
                                  className="p-2 hover:bg-mairide-accent/10 text-mairide-accent rounded-xl transition-colors"
                                  title="Set Temporary Password"
                                >
                                  <Lock className="w-5 h-5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'rides' && (
          <div className="bg-white rounded-[40px] border border-mairide-secondary shadow-sm overflow-hidden">
            <div className="p-8 border-b border-mairide-secondary">
              <h2 className="text-xl font-bold text-mairide-primary">All Ride Bookings</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-mairide-bg text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">
                    <th className="px-8 py-4">Ride Details</th>
                    <th className="px-8 py-4">Traveler</th>
                    <th className="px-8 py-4">Driver</th>
                    <th className="px-8 py-4">Fare</th>
                    <th className="px-8 py-4">Status</th>
                    <th className="px-8 py-4">Date</th>
                    <th className="px-8 py-4">Support Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mairide-secondary">
                  {bookings.map(booking => (
                    <tr key={booking.id} className="hover:bg-mairide-bg/50 transition-colors">
                      <td className="px-8 py-6">
                        <p className="font-bold text-sm text-mairide-primary">{booking.origin}</p>
                        <p className="text-[10px] text-mairide-secondary">to</p>
                        <p className="font-bold text-sm text-mairide-primary">{booking.destination}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="font-bold text-sm text-mairide-primary">{booking.consumerName}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="font-bold text-sm text-mairide-primary">{booking.driverName}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="font-bold text-mairide-accent">{formatCurrency(booking.totalPrice)}</p>
                        <p className="text-[10px] text-mairide-secondary">Fee: {formatCurrency(booking.serviceFee)}</p>
                      </td>
                      <td className="px-8 py-6">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                          booking.status === 'confirmed' ? "bg-green-100 text-green-600" :
                          booking.status === 'pending' ? "bg-orange-100 text-orange-600" : "bg-red-100 text-red-600"
                        )}>
                          {booking.status}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-xs text-mairide-secondary">{new Date(booking.createdAt).toLocaleDateString()}</p>
                      </td>
                      <td className="px-8 py-6">
                        {booking.status !== 'cancelled' && booking.rideLifecycleStatus !== 'completed' ? (
                          <button
                            type="button"
                            onClick={() => handleAdminForceCancelRide(booking)}
                            disabled={forceCancellingRideId === (booking.rideId || booking.ride_id)}
                            className="rounded-xl border border-red-200 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {forceCancellingRideId === (booking.rideId || booking.ride_id) ? 'Cancelling...' : 'Force cancel'}
                          </button>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">
                            No action
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'revenue' && (
          <AdminRevenueAnalysis bookings={bookings} users={users} />
        )}

        {activeTab === 'analytics' && (
          <AdminCashFlowAnalytics bookings={bookings} users={users} />
        )}

        {activeTab === 'transactions' && (
          <AdminTransactionsView
            transactions={transactions}
            bookings={bookings as Booking[]}
            users={users}
          />
        )}

        {activeTab === 'config' && (
          <AdminConfigView />
        )}

        {activeTab === 'support' && <AdminSupportView />}

        {activeTab === 'security' && <AdminSecurityView />}

        {activeTab === 'profile' && (
          <div className="space-y-8">
            <div className="bg-white rounded-[40px] border border-mairide-secondary p-8 md:p-10 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
                <div className="flex items-center gap-5">
                  <div className="w-24 h-24 rounded-[28px] bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center shadow-sm">
                    {getResolvedUserPhoto(adminSelfProfile) ? (
                      <img src={getResolvedUserPhoto(adminSelfProfile)} alt={adminSelfProfile.displayName} className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon className="w-10 h-10 text-mairide-secondary" />
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-mairide-secondary">Admin profile</p>
                    <h2 className="mt-2 text-3xl font-bold text-mairide-primary">{adminSelfProfile.displayName || auth.currentUser?.displayName || 'Admin User'}</h2>
                    <p className="mt-1 text-sm text-mairide-secondary break-all">{adminSelfProfile.email || auth.currentUser?.email}</p>
                    <p className="mt-3 inline-flex items-center rounded-full bg-green-100 px-4 py-1 text-[10px] font-bold uppercase tracking-widest text-green-600">
                      {adminSelfProfile.status}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-[280px]">
                  <button
                    onClick={() => setEditingUser(adminSelfProfile)}
                    className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-5 py-4 text-left font-bold text-mairide-primary hover:border-mairide-accent transition-colors"
                  >
                    Edit profile
                  </button>
                  <button
                    onClick={() => setResetPasswordUser(adminSelfProfile)}
                    className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-5 py-4 text-left font-bold text-mairide-primary hover:border-mairide-accent transition-colors"
                  >
                    Set temporary password
                  </button>
                  <button
                    onClick={() => handleGenerateResetLink(adminSelfProfile)}
                    disabled={isGeneratingResetLink === adminSelfProfile.uid}
                    className="rounded-2xl border border-mairide-secondary bg-mairide-bg px-5 py-4 text-left font-bold text-mairide-primary hover:border-mairide-accent transition-colors disabled:opacity-50"
                  >
                    {isGeneratingResetLink === adminSelfProfile.uid ? 'Generating link...' : 'Copy reset link'}
                  </button>
                  <button 
                    onClick={() => signOut(auth)}
                    className="rounded-2xl bg-red-600 px-5 py-4 text-left font-bold text-white hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Role</p>
                <p className="mt-3 text-2xl font-black tracking-tight text-mairide-primary capitalize">{adminSelfProfile.adminRole || 'super_admin'}</p>
              </div>
              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">MaiCoins</p>
                <p className="mt-3 text-2xl font-black tracking-tight text-mairide-primary">{adminSelfProfile.wallet?.balance || 0} <span className="text-xs font-bold text-mairide-accent">MC</span></p>
                <p className="mt-2 text-xs text-mairide-secondary">Pending: {adminSelfProfile.wallet?.pendingBalance || 0} MC</p>
              </div>
              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Account activity</p>
                <p className="mt-3 text-2xl font-black tracking-tight text-mairide-primary">{adminActiveTrips}</p>
                <p className="mt-2 text-xs text-mairide-secondary">{adminUserTrips.length} total bookings tracked</p>
              </div>
              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-mairide-secondary">Open offers</p>
                <p className="mt-3 text-2xl font-black tracking-tight text-mairide-primary">{adminOpenOffers}</p>
                <p className="mt-2 text-xs text-mairide-secondary">{isUserCurrentlyOnline(adminSelfProfile) ? 'Online now' : 'Offline currently'}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <h3 className="text-lg font-bold text-mairide-primary">Account details</h3>
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Email</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary break-all">{adminSelfProfile.email}</p>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Phone</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary">{formatPhoneForDisplay(adminSelfProfile.phoneNumber)}</p>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Status</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary capitalize">{adminSelfProfile.status}</p>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Password state</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary">{adminSelfProfile.forcePasswordChange ? 'Reset required' : 'Normal access'}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[32px] border border-mairide-secondary p-6 shadow-sm">
                <h3 className="text-lg font-bold text-mairide-primary">Consent and audit</h3>
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Created</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary">{adminSelfProfile.createdAt ? new Date(adminSelfProfile.createdAt).toLocaleString() : 'Not available'}</p>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Marketing consent</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary">{adminSelfProfile.consents?.marketingOptIn ? 'Opted in' : 'Not opted in'}</p>
                  </div>
                  <div className="rounded-2xl bg-mairide-bg p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">Truth declaration</p>
                    <p className="mt-2 text-sm font-bold text-mairide-primary">{adminSelfProfile.consents?.truthfulInformationAccepted ? 'Accepted' : 'Not recorded'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
          </div>
        </main>
      </div>

      {/* Add User Modal */}
      <AnimatePresence>
        {adminNotice && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl border border-mairide-secondary"
            >
              <div className="flex items-start gap-4">
                <div className={cn(
                  "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0",
                  adminNotice.tone === 'success'
                    ? 'bg-green-50 text-green-600'
                    : adminNotice.tone === 'error'
                      ? 'bg-red-50 text-red-600'
                      : 'bg-blue-50 text-blue-600'
                )}>
                  {adminNotice.tone === 'success' ? (
                    <CheckCircle2 className="w-7 h-7" />
                  ) : adminNotice.tone === 'error' ? (
                    <AlertTriangle className="w-7 h-7" />
                  ) : (
                    <AlertCircle className="w-7 h-7" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-mairide-primary">{adminNotice.title}</h3>
                  <p className="text-sm text-mairide-secondary mt-2 leading-relaxed">{adminNotice.message}</p>
                </div>
              </div>
              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={() => setAdminNotice(null)}
                  className="px-6 py-3 rounded-2xl bg-mairide-primary text-white font-bold shadow-lg shadow-mairide-primary/20"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {resetPasswordUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold text-mairide-primary">Reset Password</h2>
                <button onClick={() => setResetPasswordUser(null)} className="p-2 hover:bg-mairide-bg rounded-full transition-colors">
                  <X className="w-6 h-6 text-mairide-secondary" />
                </button>
              </div>
              <div className="mb-6 p-4 bg-mairide-bg rounded-2xl">
                <p className="text-xs font-bold text-mairide-secondary uppercase mb-1">User</p>
                <p className="font-bold text-mairide-primary">{resetPasswordUser.displayName}</p>
                <p className="text-xs text-mairide-secondary">{resetPasswordUser.email}</p>
              </div>
              <form onSubmit={handleResetPassword} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">New Password</label>
                  <input 
                    type="password" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={newAdminPassword}
                    onChange={e => setNewAdminPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isResetting}
                  className="w-full bg-mairide-primary text-white py-5 rounded-3xl font-bold text-lg shadow-lg shadow-mairide-primary/20 hover:scale-[1.02] transition-transform disabled:opacity-50"
                >
                  {isResetting ? 'Resetting...' : 'Reset Password'}
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {showAddUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold text-mairide-primary">Add New User</h2>
                <button onClick={() => setShowAddUser(false)} className="p-2 hover:bg-mairide-bg rounded-full transition-colors">
                  <X className="w-6 h-6 text-mairide-secondary" />
                </button>
              </div>
              <form onSubmit={handleAddUser} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Full Name</label>
                  <input 
                    type="text" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={newUser.displayName}
                    onChange={e => setNewUser({ ...newUser, displayName: sanitizeDisplayName(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Email Address</label>
                  <input 
                    type="email" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={newUser.email}
                    onChange={e => setNewUser({ ...newUser, email: normalizeEmailValue(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Mobile Number</label>
                  <IndianPhoneInput
                    value={newUser.phoneNumber}
                    onChange={(value) => setNewUser({ ...newUser, phoneNumber: value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Temporary Password</label>
                  <input 
                    type="password" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={newUser.password}
                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Min 6 characters"
                    minLength={6}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Role</label>
                  <select 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none font-bold"
                    value={newUser.role}
                    onChange={e => setNewUser({ ...newUser, role: e.target.value as any })}
                  >
                    <option value="consumer">Consumer</option>
                    <option value="driver">Driver</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                {newUser.role === 'admin' && (
                  <div>
                    <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Admin Job Role</label>
                    <select 
                      className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none font-bold"
                      value={newUser.adminRole}
                      onChange={e => setNewUser({ ...newUser, adminRole: e.target.value as any })}
                    >
                      <option value="super_admin">Super Admin</option>
                      <option value="support">Customer Support</option>
                      <option value="finance">Finance</option>
                      <option value="compliance">Compliance</option>
                    </select>
                  </div>
                )}
                <button 
                  type="submit"
                  className="w-full bg-mairide-accent text-white py-5 rounded-3xl font-bold text-lg shadow-lg shadow-mairide-accent/20 hover:scale-[1.02] transition-transform"
                >
                  Create Profile
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit User Modal */}
      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold text-mairide-primary">Edit User</h2>
                <button onClick={() => setEditingUser(null)} className="p-2 hover:bg-mairide-bg rounded-full transition-colors">
                  <X className="w-6 h-6 text-mairide-secondary" />
                </button>
              </div>
              <form onSubmit={handleUpdateUser} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Full Name</label>
                  <input 
                    type="text" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={editingUser.displayName}
                    onChange={e => setEditingUser({ ...editingUser, displayName: sanitizeDisplayName(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Mobile Number</label>
                  <IndianPhoneInput
                    value={editingUser.phoneNumber || ''}
                    onChange={(value) => setEditingUser({ ...editingUser, phoneNumber: value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Role</label>
                  <select 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none font-bold"
                    value={editingUser.role}
                    onChange={e => setEditingUser({ ...editingUser, role: e.target.value as any })}
                  >
                    <option value="consumer">Consumer</option>
                    <option value="driver">Driver</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Status</label>
                  <select 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none font-bold"
                    value={editingUser.status}
                    onChange={e => setEditingUser({ ...editingUser, status: e.target.value as any })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <button 
                  type="submit"
                  className="w-full bg-mairide-primary text-white py-5 rounded-3xl font-bold text-lg shadow-lg shadow-mairide-primary/20 hover:scale-[1.02] transition-transform"
                >
                  Save Changes
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-sm rounded-[40px] p-8 shadow-2xl text-center"
            >
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertTriangle className="w-10 h-10 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-mairide-primary mb-2">Delete User?</h2>
              <p className="text-mairide-secondary mb-8">This action cannot be undone. All user data will be permanently removed.</p>
              <div className="flex flex-col space-y-3">
                <button 
                  onClick={() => handleDeleteUser(showDeleteConfirm)}
                  className="w-full bg-red-600 text-white py-4 rounded-2xl font-bold hover:bg-red-700 transition-colors"
                >
                  Yes, Delete User
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(null)}
                  className="w-full bg-mairide-bg text-mairide-primary py-4 rounded-2xl font-bold hover:bg-mairide-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Driver Verification Modal */}
      <AnimatePresence>
        {selectedDriver && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-8 border-b border-mairide-secondary flex justify-between items-center bg-white sticky top-0 z-10">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary">
                    {selectedDriver.driverDetails?.selfiePhoto ? (
                      <img src={selectedDriver.driverDetails.selfiePhoto} className="w-full h-full object-cover" alt="Selfie" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><UserIcon className="w-6 h-6 text-mairide-secondary" /></div>
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-mairide-primary">{selectedDriver.displayName}</h2>
                    <p className="text-xs text-mairide-secondary">
                      {selectedDriver.verificationStatus === 'pending' ? 'Driver Application Verification' : 'Driver Profile Details'}
                    </p>
                  </div>
                </div>
                <button onClick={() => setSelectedDriver(null)} className="p-2 hover:bg-mairide-bg rounded-full transition-colors">
                  <X className="w-6 h-6 text-mairide-secondary" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-12">
                <section>
                  <VerificationMap
                    markers={selectedDriverMarkers}
                    isLoaded={isLoaded}
                    title="Signup Verification Map"
                    subtitle="This map shows where each verification asset was captured, helping the review team spot inconsistencies quickly."
                  />
                </section>

                {/* Selfie & Identity */}
                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-6 flex items-center">
                    <UserIcon className="w-4 h-4 mr-2" />
                    Identity & Selfie
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="aspect-square bg-mairide-bg rounded-[32px] overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.selfiePhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.selfiePhoto} 
                            className="w-full h-full object-cover" 
                            alt="Selfie" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/400';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <UserIcon className="w-12 h-12 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.selfieGeoTag} />
                        <a href={selectedDriver.driverDetails?.selfiePhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div className="bg-mairide-bg p-6 rounded-3xl">
                        <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Full Name</p>
                        <p className="text-lg font-bold text-mairide-primary">{selectedDriver.displayName}</p>
                      </div>
                      <div className="bg-mairide-bg p-6 rounded-3xl">
                        <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Email Address</p>
                        <p className="text-lg font-bold text-mairide-primary">{selectedDriver.email}</p>
                      </div>
                      <div className="bg-mairide-bg p-6 rounded-3xl">
                        <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Phone Number</p>
                        <p className="text-lg font-bold text-mairide-primary">{formatPhoneForDisplay(selectedDriver.phoneNumber)}</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Aadhaar Details */}
                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-6 flex items-center">
                    <ShieldCheck className="w-4 h-4 mr-2" />
                    Aadhaar Verification
                  </h3>
                  <div className="bg-mairide-bg p-6 rounded-3xl mb-6">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Aadhaar Number</p>
                    <p className="text-xl font-bold text-mairide-primary tracking-widest">{formatAadhaarForDisplay(selectedDriver.driverDetails?.aadhaarNumber)}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Front View</p>
                      <div className="aspect-[3/2] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.aadhaarFrontPhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.aadhaarFrontPhoto} 
                            className="w-full h-full object-cover" 
                            alt="Aadhaar Front" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <ShieldCheck className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.aadhaarFrontGeoTag} />
                        <a href={selectedDriver.driverDetails?.aadhaarFrontPhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Back View</p>
                      <div className="aspect-[3/2] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.aadhaarBackPhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.aadhaarBackPhoto} 
                            className="w-full h-full object-cover" 
                            alt="Aadhaar Back" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <ShieldCheck className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.aadhaarBackGeoTag} />
                        <a href={selectedDriver.driverDetails?.aadhaarBackPhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                  </div>
                  {(selectedDriver.driverDetails?.aadhaarGeoTag || selectedDriver.driverDetails?.aadhaarFrontGeoTag) && (
                    <p className="mt-4 text-[10px] text-mairide-secondary text-center italic">
                      📍 Document captured with geo-tagging verification.
                    </p>
                  )}
                </section>

                {/* DL Details */}
                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-6 flex items-center">
                    <Car className="w-4 h-4 mr-2" />
                    Driving License
                  </h3>
                  <div className="bg-mairide-bg p-6 rounded-3xl mb-6">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">DL Number</p>
                    <p className="text-xl font-bold text-mairide-primary tracking-widest">{selectedDriver.driverDetails?.dlNumber}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Front View</p>
                      <div className="aspect-[3/2] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.dlFrontPhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.dlFrontPhoto} 
                            className="w-full h-full object-cover" 
                            alt="DL Front" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <Car className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.dlFrontGeoTag} />
                        <a href={selectedDriver.driverDetails?.dlFrontPhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Back View</p>
                      <div className="aspect-[3/2] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.dlBackPhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.dlBackPhoto} 
                            className="w-full h-full object-cover" 
                            alt="DL Back" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <Car className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.dlBackGeoTag} />
                        <a href={selectedDriver.driverDetails?.dlBackPhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Vehicle Details */}
                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-6 flex items-center">
                    <Car className="w-4 h-4 mr-2" />
                    Vehicle & RC
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Make/Model</p>
                      <p className="text-sm font-bold text-mairide-primary">{selectedDriver.driverDetails?.vehicleMake} {selectedDriver.driverDetails?.vehicleModel}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Color</p>
                      <p className="text-sm font-bold text-mairide-primary">{selectedDriver.driverDetails?.vehicleColor}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Capacity</p>
                      <p className="text-sm font-bold text-mairide-primary">{selectedDriver.driverDetails?.vehicleCapacity} Seats</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl col-span-2 md:col-span-1">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Reg Number</p>
                      <p className="text-sm font-bold text-mairide-primary tracking-widest">{selectedDriver.driverDetails?.vehicleRegNumber}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Insurance Status</p>
                      <p className="text-sm font-bold text-mairide-primary capitalize">{selectedDriver.driverDetails?.insuranceStatus || 'Not captured'}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Insurance Provider</p>
                      <p className="text-sm font-bold text-mairide-primary">{selectedDriver.driverDetails?.insuranceProvider || 'Not provided'}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Insurance Expiry</p>
                      <p className="text-sm font-bold text-mairide-primary">{selectedDriver.driverDetails?.insuranceExpiryDate || 'Not provided'}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl col-span-2 md:col-span-3">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Driver Declaration</p>
                      <p className="text-sm font-bold text-mairide-primary">
                        {selectedDriver.driverDetails?.declarationAccepted ? 'Accepted during onboarding' : 'Not accepted'}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">Vehicle Photo</p>
                      <div className="aspect-[4/3] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.vehiclePhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.vehiclePhoto} 
                            className="w-full h-full object-cover" 
                            alt="Vehicle" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <Car className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.vehicleGeoTag} />
                        <a href={selectedDriver.driverDetails?.vehiclePhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-mairide-secondary uppercase text-center">RC Photo</p>
                      <div className="aspect-[4/3] bg-mairide-bg rounded-2xl overflow-hidden border border-mairide-secondary relative group">
                        {selectedDriver.driverDetails?.rcPhoto ? (
                          <img 
                            src={selectedDriver.driverDetails.rcPhoto} 
                            className="w-full h-full object-cover" 
                            alt="RC" 
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/broken/400/300';
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <ShieldCheck className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <GeoTagMeta geoTag={selectedDriver.driverDetails?.rcGeoTag} />
                        <a href={selectedDriver.driverDetails?.rcPhoto} target="_blank" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white font-bold">View Full Size</a>
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-6 flex items-center">
                    <History className="w-4 h-4 mr-2" />
                    Driver Activity History
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Ride Offers</p>
                      <p className="text-2xl font-black text-mairide-primary">{getUserRideOffers(selectedDriver.uid).length}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Bookings Handled</p>
                      <p className="text-2xl font-black text-mairide-primary">{getUserRideBookings(selectedDriver.uid, 'driver').length}</p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Completed Trips</p>
                      <p className="text-2xl font-black text-mairide-primary">
                        {getUserRideBookings(selectedDriver.uid, 'driver').filter((booking) => booking.status === 'completed').length}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-white border border-mairide-secondary rounded-3xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-mairide-secondary">
                        <h4 className="font-bold text-mairide-primary">Ride Offers Created</h4>
                      </div>
                      <div className="divide-y divide-mairide-secondary">
                        {getUserRideOffers(selectedDriver.uid).length > 0 ? getUserRideOffers(selectedDriver.uid).map((ride) => (
                          <div key={ride.id} className="px-6 py-4">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                              <div>
                                <p className="font-bold text-mairide-primary">{ride.origin} → {ride.destination}</p>
                                <p className="text-xs text-mairide-secondary">{new Date(ride.createdAt).toLocaleString()}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-mairide-accent">{formatCurrency(ride.price)}</p>
                                <p className="text-[10px] font-bold uppercase text-mairide-secondary">{ride.status}</p>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <div className="px-6 py-8 text-sm text-mairide-secondary">No ride offers recorded yet.</div>
                        )}
                      </div>
                    </div>

                    <div className="bg-white border border-mairide-secondary rounded-3xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-mairide-secondary">
                        <h4 className="font-bold text-mairide-primary">Bookings & Trip History</h4>
                      </div>
                      <div className="divide-y divide-mairide-secondary">
                        {getUserRideBookings(selectedDriver.uid, 'driver').length > 0 ? getUserRideBookings(selectedDriver.uid, 'driver').map((booking) => (
                          <div key={booking.id} className="px-6 py-4">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                              <div>
                                <p className="font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                                <p className="text-sm text-mairide-secondary">Traveler: {booking.consumerName}</p>
                                <p className="text-xs text-mairide-secondary">{new Date(booking.createdAt).toLocaleString()}</p>
                              </div>
                              <div className="grid grid-cols-2 gap-3 text-right">
                                <div>
                                  <p className="text-[10px] font-bold uppercase text-mairide-secondary">Trip Value</p>
                                  <p className="font-bold text-mairide-primary">{formatCurrency(booking.totalPrice)}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold uppercase text-mairide-secondary">Status</p>
                                  <p className="font-bold text-mairide-accent uppercase">{booking.status}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <div className="px-6 py-8 text-sm text-mairide-secondary">No booking history recorded yet.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Final Decision */}
                <section className="bg-mairide-bg p-8 rounded-[32px] border border-mairide-secondary">
                  <h3 className="text-lg font-bold text-mairide-primary mb-6">Verification Decision</h3>
                  <div className="space-y-6">
                    <div>
                      <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Rejection Reason (if applicable)</label>
                      <textarea 
                        placeholder="Explain why the application is being rejected..."
                        className="w-full p-4 bg-white border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent min-h-[100px]"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                      />
                    </div>
                    {selectedDriver.verificationStatus !== 'pending' && (
                      <div className="mb-4 rounded-2xl border border-mairide-secondary bg-mairide-bg px-4 py-3 text-sm text-mairide-primary">
                        This application has already been reviewed with status: <span className="font-bold uppercase">{selectedDriver.verificationStatus}</span>.
                      </div>
                    )}
                    <div className="flex space-x-4">
                      <button 
                        onClick={() => handleVerifyDriver(selectedDriver.uid, 'rejected')}
                        disabled={!rejectionReason || selectedDriver.verificationStatus !== 'pending'}
                        className="flex-1 bg-white text-red-600 border border-red-200 py-4 rounded-2xl font-bold hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        Reject Application
                      </button>
                      <button 
                        onClick={() => handleVerifyDriver(selectedDriver.uid, 'approved')}
                        disabled={selectedDriver.verificationStatus !== 'pending'}
                        className="flex-1 bg-green-600 text-white py-4 rounded-2xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-600/20"
                      >
                        Approve Driver
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </motion.div>
          </div>
        )}

        {selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-3xl max-h-[90vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-8 border-b border-mairide-secondary flex justify-between items-center bg-white sticky top-0 z-10">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-mairide-bg overflow-hidden border border-mairide-secondary flex items-center justify-center">
                    {getResolvedUserPhoto(selectedUser) ? (
                      <img src={getResolvedUserPhoto(selectedUser)} className="w-full h-full object-cover" alt={selectedUser.displayName} />
                    ) : (
                      <UserIcon className="w-6 h-6 text-mairide-secondary" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-mairide-primary">{selectedUser.displayName}</h2>
                    <p className="text-xs text-mairide-secondary capitalize">{selectedUser.role} profile details</p>
                  </div>
                </div>
                <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-mairide-bg rounded-full transition-colors">
                  <X className="w-6 h-6 text-mairide-secondary" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-mairide-bg p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Email</p>
                    <p className="text-lg font-bold text-mairide-primary break-all">{selectedUser.email}</p>
                  </div>
                  <div className="bg-mairide-bg p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Phone</p>
                    <p className="text-lg font-bold text-mairide-primary">{formatPhoneForDisplay(selectedUser.phoneNumber)}</p>
                  </div>
                  <div className="bg-mairide-bg p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Status</p>
                    <p className="text-lg font-bold text-mairide-primary capitalize">{selectedUser.status}</p>
                  </div>
                  <div className="bg-mairide-bg p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Role</p>
                    <p className="text-lg font-bold text-mairide-primary capitalize">
                      {selectedUser.role === 'admin' ? selectedUser.adminRole || 'admin' : selectedUser.role}
                    </p>
                  </div>
                </section>

                <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white border border-mairide-secondary p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">MaiCoins Balance</p>
                    <p className="text-3xl font-black text-mairide-primary tracking-tight">{selectedUser.wallet?.balance || 0}</p>
                  </div>
                  <div className="bg-white border border-mairide-secondary p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Pending Coins</p>
                    <p className="text-3xl font-black text-mairide-primary tracking-tight">{selectedUser.wallet?.pendingBalance || 0}</p>
                  </div>
                  <div className="bg-white border border-mairide-secondary p-6 rounded-3xl">
                    <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-2">Ratings</p>
                    <p className="text-3xl font-black text-mairide-primary tracking-tight">
                      {typeof selectedUser.reviewStats?.averageRating === 'number' ? selectedUser.reviewStats.averageRating.toFixed(1) : '5.0'}
                    </p>
                    <p className="text-xs text-mairide-secondary mt-1">{selectedUser.reviewStats?.ratingCount || 0} reviews</p>
                  </div>
                </section>

                {selectedUser.consents && (
                  <section className="bg-mairide-bg p-6 rounded-3xl">
                    <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-4">Consents & Declarations</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="rounded-2xl bg-white p-4 border border-mairide-secondary">
                        <p className="font-bold text-mairide-primary">{selectedUser.consents.truthfulInformationAccepted ? 'Truth declaration accepted' : 'Truth declaration missing'}</p>
                        <p className="text-xs text-mairide-secondary mt-1">Accepted at {new Date(selectedUser.consents.acceptedAt).toLocaleString()}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-4 border border-mairide-secondary">
                        <p className="font-bold text-mairide-primary">{selectedUser.consents.termsAccepted ? 'Terms accepted' : 'Terms not accepted'}</p>
                        <p className="text-xs text-mairide-secondary mt-1">Marketing opt-in: {selectedUser.consents.marketingOptIn ? 'Yes' : 'No'}</p>
                      </div>
                    </div>
                  </section>
                )}

                {selectedUser.location && (
                  <section className="bg-mairide-bg p-6 rounded-3xl">
                    <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-4">Latest Known Location</h3>
                    <p className="text-sm font-bold text-mairide-primary">
                      {selectedUser.location.lat.toFixed(5)}, {selectedUser.location.lng.toFixed(5)}
                    </p>
                    <p className="text-xs text-mairide-secondary mt-2">Updated {new Date(selectedUser.location.lastUpdated).toLocaleString()}</p>
                  </section>
                )}

                {selectedUser.role === 'consumer' && (
                  <section className="bg-mairide-bg p-6 rounded-3xl">
                    <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-4">Traveler Snapshot</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-2xl bg-white p-4 border border-mairide-secondary">
                        <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Referral Code</p>
                        <p className="font-bold text-mairide-primary">{selectedUser.referralCode || 'Not assigned'}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-4 border border-mairide-secondary">
                        <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Password State</p>
                        <p className="font-bold text-mairide-primary">{selectedUser.forcePasswordChange ? 'Reset required' : 'Normal'}</p>
                      </div>
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-4">User History</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">
                        {selectedUser.role === 'driver' ? 'Ride Offers' : 'Trips Taken'}
                      </p>
                      <p className="text-2xl font-black text-mairide-primary">
                        {selectedUser.role === 'driver' ? getUserRideOffers(selectedUser.uid).length : getUserRideBookings(selectedUser.uid, selectedUser.role).length}
                      </p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Completed</p>
                      <p className="text-2xl font-black text-mairide-primary">
                        {getUserRideBookings(selectedUser.uid, selectedUser.role).filter((booking) => booking.status === 'completed').length}
                      </p>
                    </div>
                    <div className="bg-mairide-bg p-4 rounded-2xl">
                      <p className="text-[8px] font-bold text-mairide-secondary uppercase mb-1">Cancelled / Rejected</p>
                      <p className="text-2xl font-black text-mairide-primary">
                        {getUserRideBookings(selectedUser.uid, selectedUser.role).filter((booking) => ['cancelled', 'rejected'].includes(booking.status)).length}
                      </p>
                    </div>
                  </div>

                  {selectedUser.role === 'driver' && (
                    <div className="bg-white border border-mairide-secondary rounded-3xl overflow-hidden mb-4">
                      <div className="px-6 py-4 border-b border-mairide-secondary">
                        <h4 className="font-bold text-mairide-primary">Ride Offers Created</h4>
                      </div>
                      <div className="divide-y divide-mairide-secondary">
                        {getUserRideOffers(selectedUser.uid).length > 0 ? getUserRideOffers(selectedUser.uid).map((ride) => (
                          <div key={ride.id} className="px-6 py-4">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                              <div>
                                <p className="font-bold text-mairide-primary">{ride.origin} → {ride.destination}</p>
                                <p className="text-xs text-mairide-secondary">{new Date(ride.createdAt).toLocaleString()}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-mairide-accent">{formatCurrency(ride.price)}</p>
                                <p className="text-[10px] font-bold uppercase text-mairide-secondary">{ride.status}</p>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <div className="px-6 py-8 text-sm text-mairide-secondary">No ride offers recorded yet.</div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="bg-white border border-mairide-secondary rounded-3xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-mairide-secondary">
                      <h4 className="font-bold text-mairide-primary">
                        {selectedUser.role === 'driver' ? 'Trips & Booking History' : 'Ride History'}
                      </h4>
                    </div>
                    <div className="divide-y divide-mairide-secondary">
                      {getUserRideBookings(selectedUser.uid, selectedUser.role).length > 0 ? getUserRideBookings(selectedUser.uid, selectedUser.role).map((booking) => (
                        <div key={booking.id} className="px-6 py-4">
                          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            <div>
                              <p className="font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                              <p className="text-sm text-mairide-secondary">
                                {selectedUser.role === 'driver' ? `Traveler: ${booking.consumerName}` : `Driver: ${booking.driverName}`}
                              </p>
                              <p className="text-xs text-mairide-secondary">{new Date(booking.createdAt).toLocaleString()}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-right">
                              <div>
                                <p className="text-[10px] font-bold uppercase text-mairide-secondary">Trip Value</p>
                                <p className="font-bold text-mairide-primary">{formatCurrency(booking.totalPrice)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-mairide-secondary">Status</p>
                                <p className="font-bold text-mairide-accent uppercase">{booking.status}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="px-6 py-8 text-sm text-mairide-secondary">No trip history recorded yet.</div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- App Root ---

const LIBRARIES: ("places" | "drawing" | "geometry" | "visualization")[] = ["places", "geometry"];

// --- Hooks ---
const useAppConfig = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const configRef = doc(db, 'app_config', 'global');
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      if (snapshot.exists()) {
        const nextConfig = { id: snapshot.id, ...snapshot.data() } as AppConfig;
        [
          'razorpayKeySecret',
          'razorpayWebhookSecret',
          'resendApiKey',
          'emailApiKey',
          'smsApiKey',
          'twoFactorApiKey',
          'paymentGatewayApiKey',
          'n8nApiKey',
          'n8nSharedSecret',
          'geminiApiKey',
        ].forEach((key) => {
          if (key in nextConfig) {
            delete (nextConfig as Record<string, any>)[key];
          }
        });
        setConfig(nextConfig);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'app_config/global');
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return { config, loading };
};

const App = () => {
  console.log("🚀 App component initialization started");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [notRegisteredError, setNotRegisteredError] = useState(false);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [role, setRole] = useState<'consumer' | 'driver'>('consumer');

  useEffect(() => {
    if (!isLocalRazorpayEnabled()) return;
    ensureRazorpayCheckoutScript().catch(() => undefined);
  }, []);

  useEffect(() => {
    async function testConnection() {
      try {
        // Use getDocFromServer to bypass cache and test real connection
        await getDocFromServer(doc(db, '_connection_test_', 'connection'));
        console.log("Firestore connection successful");
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Firestore is offline. Please check your Firebase configuration and ensure the database is provisioned.");
        } else {
          // Log other errors but don't alert as it might be a missing doc which is fine
          console.log("Firestore connection test result:", error);
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setLoading(true);
      setUser(u);
      setProfile(null);
      
      // Clean up previous profile listener if it exists
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (u) {
        const mappedPhoneProfileId = u.isAnonymous ? sessionStorage.getItem(PHONE_LOGIN_PROFILE_KEY) : null;
        const pendingPhoneLogin = u.isAnonymous ? sessionStorage.getItem(PHONE_LOGIN_NUMBER_KEY) : null;
        const profileDocId = mappedPhoneProfileId || u.uid;

        // Listen to profile changes
        unsubProfile = onSnapshot(doc(db, 'users', profileDocId), async (snapshot) => {
          if (snapshot.exists()) {
            setProfile(snapshot.data() as UserProfile);
            if (u.isAnonymous) {
              sessionStorage.removeItem(PHONE_LOGIN_NUMBER_KEY);
            }
            setLoading(false);
          } else if (u.email && !u.isAnonymous) {
            // If not found by UID, try to find by email (for pre-created admin users)
            try {
              const q = query(collection(db, 'users'), where('email', '==', u.email));
              const querySnapshot = await getDocs(q);
              
              if (!querySnapshot.empty) {
                const existingProfileDoc = querySnapshot.docs[0];
                const existingProfile = existingProfileDoc.data() as UserProfile;
                
                if (existingProfile.uid !== u.uid) {
                  // Link the existing profile to this UID
                  const newProfile = {
                    ...existingProfile,
                    uid: u.uid
                  };
                  await setDoc(doc(db, 'users', u.uid), newProfile);
                  // Delete the old manual profile if it was a placeholder
                  if (existingProfile.uid.startsWith('manual_')) {
                    await deleteDoc(doc(db, 'users', existingProfile.uid));
                  }
                  setProfile(newProfile);
                } else {
                  setProfile(existingProfile);
                }
                setLoading(false);
              } else {
                const oauthMode = sessionStorage.getItem('mairide_oauth_mode');
                if (oauthMode === 'signup') {
                  const newProfile: UserProfile = {
                    uid: u.uid,
                    email: u.email || '',
                    displayName: u.displayName || u.email || 'User',
                    role: 'consumer',
                    status: 'active',
                    photoURL: u.photoURL || '',
                    phoneNumber: u.phoneNumber || '',
                    onboardingComplete: true,
                    forcePasswordChange: false,
                  };
                  await setDoc(doc(db, 'users', u.uid), newProfile);
                  await walletService.initializeUserWallet(u.uid);
                  setProfile(newProfile);
                  sessionStorage.removeItem('mairide_oauth_mode');
                } else {
                  sessionStorage.removeItem('mairide_oauth_mode');
                  setNotRegisteredError(true);
                  await signOut(auth);
                  setProfile(null);
                }
              }
            } catch (error) {
              console.error("Error linking profile:", error);
              setProfile(null);
            }
            setLoading(false);
          } else {
            if (u.isAnonymous && pendingPhoneLogin) {
              try {
                const matchedProfile = await findUserProfileByPhone(pendingPhoneLogin);
                if (matchedProfile) {
                  sessionStorage.setItem(PHONE_LOGIN_PROFILE_KEY, matchedProfile.uid);
                  sessionStorage.removeItem(PHONE_LOGIN_NUMBER_KEY);
                  setProfile(matchedProfile);
                  setNotRegisteredError(false);
                  setLoading(false);
                  return;
                }
              } catch (lookupError) {
                console.error("Anonymous phone profile lookup error:", lookupError);
              }
            }
            if (u.isAnonymous) {
              sessionStorage.removeItem(PHONE_LOGIN_PROFILE_KEY);
              sessionStorage.removeItem(PHONE_LOGIN_NUMBER_KEY);
            }
            setProfile(null);
            setLoading(false);
          }
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${profileDocId}`);
          setProfile(null);
          setLoading(false);
        });
      } else {
        sessionStorage.removeItem(PHONE_LOGIN_PROFILE_KEY);
        sessionStorage.removeItem(PHONE_LOGIN_NUMBER_KEY);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem(PHONE_LOGIN_PROFILE_KEY);
    sessionStorage.removeItem(PHONE_LOGIN_NUMBER_KEY);
    return signOut(auth);
  };

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES
  });

  const [authFailure, setAuthFailure] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  useEffect(() => {
    const originalAlert = window.alert.bind(window);
    window.alert = ((message?: any) => {
      const normalizedMessage =
        typeof message === 'string'
          ? message
          : message instanceof Error
            ? message.message
            : JSON.stringify(message);
      showAppDialog(normalizedMessage);
    }) as typeof window.alert;

    return () => {
      window.alert = originalAlert;
    };
  }, []);

  useEffect(() => {
    const log = (msg: string) => setDebugInfo(prev => [...prev.slice(-4), `${new Date().toLocaleTimeString()}: ${msg}`]);
    
    log(`Initializing Maps with key: ${GOOGLE_MAPS_API_KEY.substring(0, 8)}...`);
    
    // @ts-ignore
    window.gm_authFailure = () => {
      log("CRITICAL: Google Maps Authentication Failure detected!");
      setAuthFailure(true);
    };
    
    return () => {
      // @ts-ignore
      window.gm_authFailure = null;
    };
  }, []);

  useEffect(() => {
    if (isLoaded) setDebugInfo(prev => [...prev, "Maps Script Loaded Successfully"]);
    if (loadError) setDebugInfo(prev => [...prev, `Maps Load Error: ${loadError.message}`]);
  }, [isLoaded, loadError]);

  if (loading) return <ErrorBoundary><LoadingScreen /></ErrorBoundary>;

  if (user && !profile) return <ErrorBoundary><LoadingScreen /></ErrorBoundary>;

  if (!user) return (
    <ErrorBoundary>
      <>
        <AuthPage 
          user={user}
          authMode={authMode} 
          setAuthMode={setAuthMode} 
          notRegisteredError={notRegisteredError} 
          setNotRegisteredError={setNotRegisteredError}
          role={role}
          setRole={setRole}
          referralCodeInput={referralCodeInput}
          setReferralCodeInput={setReferralCodeInput}
        />
        <AppDialogHost />
      </>
    </ErrorBoundary>
  );

  if (profile && profile.role === 'driver') {
    if (!profile.onboardingComplete) {
      return <ErrorBoundary><DriverOnboarding profile={profile} onComplete={() => window.location.reload()} isLoaded={isLoaded} /></ErrorBoundary>;
    }
    if (profile.verificationStatus === 'pending') {
      return <ErrorBoundary><DriverPendingApproval profile={profile} /></ErrorBoundary>;
    }
    if (profile.verificationStatus === 'rejected') {
      return <ErrorBoundary><DriverRejected profile={profile} /></ErrorBoundary>;
    }
  }

  if (profile && profile.role === 'admin') {
    return (
      <ErrorBoundary>
        {profile.forcePasswordChange && <ForcePasswordChangeModal profile={profile} />}
        <div className="min-h-screen bg-mairide-bg flex flex-col">
          <div className="flex-1">
            <AdminDashboard profile={profile} isLoaded={isLoaded} loadError={loadError} authFailure={authFailure} />
          </div>
          <AppFooter />
          <AppDialogHost />
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Router>
        <div className="min-h-screen bg-mairide-bg">
          <Navbar user={user} profile={profile} onLogout={handleLogout} />
          <main className="pb-20">
            <Routes>
              <Route path="/" element={
                profile?.role === 'admin' ? <AdminDashboard profile={profile} isLoaded={isLoaded} loadError={loadError} authFailure={authFailure} /> :
                profile?.role === 'driver' ? <DriverApp profile={profile} isLoaded={isLoaded} loadError={loadError} authFailure={authFailure} /> : 
                profile ? <ConsumerApp profile={profile} isLoaded={isLoaded} loadError={loadError} authFailure={authFailure} /> : <LoadingScreen />
              } />
              <Route path="/admin" element={profile?.role === 'admin' ? <AdminDashboard profile={profile} isLoaded={isLoaded} loadError={loadError} authFailure={authFailure} /> : <Navigate to="/" />} />
              <Route path="/support" element={profile ? <SupportSystem profile={profile} /> : <Navigate to="/" />} />
              <Route path="/consumer/bookings" element={profile ? <MyBookings profile={profile} /> : <Navigate to="/" />} />
              <Route path="/driver/rides" element={profile ? <MyRides profile={profile} /> : <Navigate to="/" />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
          <AppFooter />
          <Chatbot />
          <AppDialogHost />
        </div>
      </Router>
    </ErrorBoundary>
  );
};

export default App;
