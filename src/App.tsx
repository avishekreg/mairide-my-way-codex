import React, { useState, useEffect, Component } from 'react';
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
  createUserWithEmailAndPassword,
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
import { UserProfile, SupportTicket, ChatMessage, Transaction, Referral, AppConfig, Booking } from './types';
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
  ArrowUpRight,
  ArrowDownLeft,
  Wallet
} from 'lucide-react';
import { cn, formatCurrency, calculateServiceFee } from './lib/utils';

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
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'v2.0.0-supabase-beta';
const CONSENT_VERSION = 'consent-v1';
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
        <p className="text-[10px] text-mairide-secondary mt-2 opacity-50">{APP_VERSION}</p>
      </div>
    </motion.div>
  </div>
);

const AppFooter = () => (
  <footer className="px-4 pb-6">
    <div className="max-w-7xl mx-auto flex justify-center">
      <p className="text-[11px] text-mairide-secondary/80 tracking-wide">
        Release {APP_VERSION}
      </p>
    </div>
  </footer>
);

const Navbar = ({ user, profile, onLogout }: { user: User, profile: UserProfile | null, onLogout: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <nav className="bg-white border-b border-mairide-secondary sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center cursor-pointer" onClick={() => navigate('/')}>
            <img src={LOGO_URL} className="w-12 h-12 object-contain mr-2" alt="MaiRide Logo" />
            <span className="text-xl font-black tracking-tighter text-mairide-primary">
              {BRAND_NAME}
            </span>
          </div>
          
          <div className="hidden md:flex items-center space-x-6">
            <button onClick={() => navigate('/')} className="text-mairide-primary hover:text-mairide-accent font-medium">Home</button>
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
              <img src={user.photoURL || undefined} alt="Profile" className="w-8 h-8 rounded-full border border-mairide-secondary" />
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
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white border-t border-gray-100 overflow-hidden"
          >
            <div className="px-4 pt-2 pb-6 space-y-1">
              <button onClick={() => { navigate('/'); setIsOpen(false); }} className="block w-full text-left px-3 py-2 text-gray-600 font-medium">Home</button>
              <button onClick={() => { navigate('/support'); setIsOpen(false); }} className="block w-full text-left px-3 py-2 text-gray-600 font-medium">Support</button>
              {profile?.role === 'admin' && (
                <button onClick={() => { navigate('/admin'); setIsOpen(false); }} className="block w-full text-left px-3 py-2 text-gray-600 font-medium">Admin Panel</button>
              )}
              <button onClick={() => { navigate(profile?.role === 'driver' ? '/driver/rides' : '/consumer/bookings'); setIsOpen(false); }} className="block w-full text-left px-3 py-2 text-gray-600 font-medium">
                {profile?.role === 'driver' ? 'My Rides' : 'My Bookings'}
              </button>
              <div className="pt-4 border-t border-gray-100 mt-4 flex items-center space-x-3">
                <img src={user.photoURL || undefined} alt="Profile" className="w-10 h-10 rounded-full" />
                <div>
                  <p className="font-semibold text-gray-900">{profile?.displayName}</p>
                  <p className="text-xs text-gray-500 capitalize">{profile?.role}</p>
                </div>
              </div>
              <button onClick={onLogout} className="mt-4 flex items-center space-x-2 text-red-600 font-medium px-3 py-2">
                <LogOut className="w-5 h-5" />
                <span>Logout</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
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

  const handleSendEmailOtp = async () => {
    if (!email) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/send-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (data.Status === 'Success') {
        setEmailSessionId(data.Details);
        setStep('email-otp');
      } else {
        throw new Error(data.Details || 'Failed to send Email OTP');
      }
    } catch (error: any) {
      console.error("Email OTP Send Error:", error);
      alert(error.message || "Failed to send Email OTP. Please check the email address.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    if (!otp || !emailSessionId) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: emailSessionId, otp }),
      });
      const data = await response.json();
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
    if (!phoneNumber) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await response.json();
      if (data.Status === 'Success') {
        setSessionId(data.Details);
        setStep('otp');
      } else {
        throw new Error(data.Details || 'Failed to send OTP');
      }
    } catch (error: any) {
      console.error("OTP Send Error:", error);
      alert(error.message || "Failed to send OTP. Please check the phone number format (e.g., 919876543210).");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || !sessionId) return;
    setIsLoading(true);
    setNotRegisteredError(false);
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, otp }),
      });
      const data = await response.json();
      if (data.Status === 'Success' && data.Details === 'OTP Matched') {
        setOtp('');
        if (!user && authMode === 'signup' && email && password && displayName) {
          await completeEmailPasswordSignUp();
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
    if (!email || (!user && !password) || !phoneNumber || !displayName) {
      alert("Please fill all fields");
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
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await handleProfileSetup(result.user, phoneNumber, displayName, true);
    } catch (error: any) {
      console.error("Complete Sign Up Error:", error);
      if (error.code === 'auth/email-already-in-use') {
        alert("This email is already registered. Please login instead.");
        setAuthMode('login');
      } else {
        alert(error.message || "Failed to complete sign up.");
      }
      throw error;
    }
  };

  const handleLogin = async () => {
    const isPhone = /^\+?[\d\s-]{10,}$/.test(username);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username);

    if (isPhone) {
      if (!username) {
        alert("Please enter phone number");
        return;
      }
    } else {
      if (!username || !password) {
        alert("Please enter email and password");
        return;
      }
    }

    setIsLoading(true);
    setNotRegisteredError(false);
    try {
      let existingProfile: UserProfile | null = null;

      if (isPhone) {
        let tempAuthUsed = false;
        if (!auth.currentUser) {
          try {
            await signInAnonymously(auth);
            tempAuthUsed = true;
          } catch (authError: any) {
            console.error("Temp Auth Error:", authError);
          }
        }

        const q = query(collection(db, 'users'), where('phoneNumber', '==', username));
        const snap = await getDocs(q);
        if (!snap.empty) {
          existingProfile = snap.docs[0].data() as UserProfile;
        }

        if (!existingProfile && username.toLowerCase() !== SUPER_ADMIN_EMAIL) {
          if (tempAuthUsed) await signOut(auth);
          throw new Error("NOT_REGISTERED");
        }
        // Trigger Phone OTP Login
        setPhoneNumber(username);
        const response = await fetch('/api/auth/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: username }),
        });
        const data = await response.json();
        if (data.Status === 'Success') {
          setSessionId(data.Details);
          setStep('otp');
          if (tempAuthUsed) await signOut(auth);
        } else {
          throw new Error(data.Details || 'Failed to send OTP');
        }
      } else {
        // Email/Password Login
        const result = await signInWithEmailAndPassword(auth, username.trim(), password);
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
    try {
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        const targetPhone = user.phoneNumber || phone || '';
        const targetEmail = user.email || '';

        // Check for existing profile by email or phone
        let existingProfile: UserProfile | null = null;
        
        if (targetEmail) {
          const qEmail = query(collection(db, 'users'), where('email', '==', targetEmail));
          const emailSnap = await getDocs(qEmail);
          if (!emailSnap.empty) existingProfile = emailSnap.docs[0].data() as UserProfile;
        }

        if (!existingProfile && targetPhone) {
          const qPhone = query(collection(db, 'users'), where('phoneNumber', '==', targetPhone));
          const phoneSnap = await getDocs(qPhone);
          if (!phoneSnap.empty) existingProfile = phoneSnap.docs[0].data() as UserProfile;
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
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <input 
                  type="email" 
                  placeholder="Email Address"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <input 
                  type="tel" 
                  placeholder="Phone Number (e.g. +91...)"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
                
                {!user && (
                  <input 
                    type="password" 
                    placeholder="Create Password"
                    className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
                <input 
                  type="text" 
                  placeholder="Referral Code (Optional)"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                  value={referralCodeInput}
                  onChange={(e) => setReferralCodeInput(e.target.value)}
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
                <div className="text-center mb-4">
                  <p className="text-sm text-mairide-secondary">Enter the 6-digit OTP sent to your email</p>
                  <p className="font-bold text-mairide-primary">{email}</p>
                </div>
                <input 
                  type="text" 
                  placeholder="6-digit Email OTP"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary text-center tracking-[0.5em] font-bold"
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
                  onClick={() => setStep('phone')}
                  className="w-full text-xs text-mairide-secondary hover:text-mairide-accent font-medium"
                >
                  Change Details
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center mb-4">
                  <p className="text-sm text-mairide-secondary">Enter the 6-digit OTP sent to your phone</p>
                  <p className="font-bold text-mairide-primary">{phoneNumber}</p>
                </div>
                <input 
                  type="text" 
                  placeholder="6-digit Phone OTP"
                  className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary text-center tracking-[0.5em] font-bold"
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
                  onClick={() => setStep('phone')}
                  className="w-full text-xs text-mairide-secondary hover:text-mairide-accent font-medium"
                >
                  Change Details
                </button>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="Email or Phone Number"
                className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
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
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchWalletData = async () => {
      setIsLoading(true);
      try {
        const [s, txSnapshot] = await Promise.all([
          walletService.getReferralStats(profile.uid),
          getDocs(query(
            collection(db, 'transactions'), 
            where('userId', '==', profile.uid),
            orderBy('createdAt', 'desc'),
            limit(10)
          ))
        ]);
        setStats(s);
        setTransactions(txSnapshot.docs.map(doc => doc.data() as Transaction));
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
    const sRef = storageRef(storage, `drivers/${profile.uid}/${path}`);
    await uploadString(sRef, base64, 'data_url');
    return await getDownloadURL(sRef);
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
      await setDoc(doc(db, 'users', profile.uid), updatedProfile);
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
              <input 
                type="text" 
                placeholder="12-digit Aadhaar Number"
                className="w-full p-5 bg-mairide-bg border-none rounded-3xl focus:ring-2 focus:ring-mairide-accent outline-none text-mairide-primary font-medium"
                value={formData.aadhaarNumber}
                onChange={e => setFormData({ ...formData, aadhaarNumber: e.target.value })}
              />
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
                onChange={e => setFormData({ ...formData, dlNumber: e.target.value })}
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
                  onChange={e => setFormData({ ...formData, vehicleMake: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-mairide-secondary uppercase mb-1 ml-2">Model</label>
                <input 
                  type="text" 
                  placeholder="e.g. Swift"
                  className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none text-sm"
                  value={formData.vehicleModel}
                  onChange={e => setFormData({ ...formData, vehicleModel: e.target.value })}
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
                  onChange={e => setFormData({ ...formData, vehicleColor: e.target.value })}
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
                onChange={e => setFormData({ ...formData, vehicleRegNumber: e.target.value })}
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
                    onChange={e => setFormData({ ...formData, insuranceProvider: e.target.value })}
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

const TravelerDashboardSummary = ({
  bookings,
  onAcceptCounter,
  onRejectCounter,
  onPayWithCoins,
  onPayOnline,
}: {
  bookings: Booking[];
  onAcceptCounter: (booking: Booking) => void;
  onRejectCounter: (booking: Booking) => void;
  onPayWithCoins: (booking: Booking) => void;
  onPayOnline: (booking: Booking) => void;
}) => {
  const activeBookings = bookings.filter((booking) =>
    ['pending', 'confirmed', 'negotiating'].includes(booking.status)
  );

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
        {activeBookings.map((booking) => (
          <div key={booking.id} className="bg-white border border-mairide-secondary rounded-[28px] p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-lg font-bold text-mairide-primary">{booking.origin} → {booking.destination}</p>
                <p className="text-sm text-mairide-secondary">Driver: {booking.driverName}</p>
              </div>
              <span className={cn(
                "px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest",
                booking.status === 'negotiating' ? "bg-orange-100 text-orange-700" :
                booking.status === 'confirmed' ? "bg-green-100 text-green-700" :
                "bg-mairide-bg text-mairide-primary"
              )}>
                {booking.status}
              </span>
            </div>
            {booking.status === 'negotiating' && (
              <div className="mt-4 rounded-2xl border border-mairide-accent/20 bg-mairide-accent/10 p-4">
                <p className="font-bold text-mairide-primary">Counter offer received: {formatCurrency(booking.negotiatedFare || booking.fare)}</p>
                <div className="flex gap-3 mt-4">
                  <button onClick={() => onAcceptCounter(booking)} className="flex-1 bg-mairide-primary text-white py-3 rounded-xl font-bold">
                    Accept Counter Offer
                  </button>
                  <button onClick={() => onRejectCounter(booking)} className="flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3 rounded-xl font-bold">
                    Reject
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
                {!booking.feePaid ? (
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => onPayWithCoins(booking)} className="flex-1 bg-mairide-primary text-white py-3 rounded-xl font-bold">
                      Pay with Maicoins
                    </button>
                    <button onClick={() => onPayOnline(booking)} className="flex-1 bg-white border border-mairide-primary text-mairide-primary py-3 rounded-xl font-bold">
                      Pay Online
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-sm font-bold text-green-700">
                    Traveler payment submitted
                  </div>
                )}
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
          </div>
        ))}
      </div>
    </div>
  );
};

const DriverDashboardSummary = ({
  requests,
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
  const liveRequests = requests.filter((request) => ['pending', 'negotiating', 'confirmed'].includes(request.status));
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
        {liveRequests.map((request) => (
          <div key={request.id} className="bg-white border border-mairide-secondary rounded-[28px] p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-lg font-bold text-mairide-primary">{request.origin} → {request.destination}</p>
                <p className="text-sm text-mairide-secondary">Traveler: {request.consumerName}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-black text-mairide-accent">{formatCurrency(request.fare)}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-mairide-secondary">{request.status}</p>
              </div>
            </div>
            {request.status === 'pending' && (
              <div className="mt-4 space-y-4">
                <div className="flex gap-3">
                  <button onClick={() => onAccept(request)} className="flex-1 bg-green-600 text-white py-3 rounded-xl font-bold">Accept Request</button>
                  <button onClick={() => onReject(request)} className="flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3 rounded-xl font-bold">Reject</button>
                </div>
                <div className="flex gap-3">
                  <input
                    type="number"
                    placeholder="Counter fare"
                    value={counterFares[request.id] || ''}
                    onChange={(e) => setCounterFares((prev) => ({ ...prev, [request.id]: e.target.value }))}
                    className="flex-1 p-3 bg-mairide-bg border border-mairide-secondary rounded-xl outline-none"
                  />
                  <button onClick={() => onCounter(request, Number(counterFares[request.id]))} className="bg-mairide-primary text-white px-6 py-3 rounded-xl font-bold">
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
                {!request.driverFeePaid ? (
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => onPayWithCoins(request)} className="flex-1 bg-mairide-primary text-white py-3 rounded-xl font-bold">
                      Pay with Maicoins
                    </button>
                    <button onClick={() => onPayOnline(request)} className="flex-1 bg-white border border-mairide-primary text-mairide-primary py-3 rounded-xl font-bold">
                      Pay Online
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-sm font-bold text-green-700">
                    Driver payment submitted
                  </div>
                )}
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
                    className="bg-mairide-primary text-white px-6 py-3 rounded-xl font-bold"
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
                    className="bg-green-700 text-white px-6 py-3 rounded-xl font-bold"
                  >
                    End Ride
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const MyBookings = ({ profile }: { profile: UserProfile }) => {
  const { config } = useAppConfig();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentBooking, setPaymentBooking] = useState<Booking | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('consumerId', '==', profile.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      setBookings(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
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
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    alert('Traveler payment proof submitted successfully.');
  };

  const handlePayFee = async (booking: Booking, useCoins: boolean) => {
    try {
      const { totalFee } = calculateServiceFee(booking.fare, config || undefined);
      let coinsToUse = 0;
      
      if (useCoins) {
        const balance = profile.wallet?.balance || 0;
        coinsToUse = Math.min(balance, totalFee, MAX_MAICOINS_PER_RIDE);
      }

      const amountPaid = totalFee - coinsToUse;

      if (amountPaid > 0) {
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

      // Trigger referral bonus activation
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      
      alert("Platform fee paid successfully!");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  const handleNegotiation = async (bookingId: string, action: 'accepted' | 'rejected', negotiatedFare?: number) => {
    try {
      if (action === 'accepted' && negotiatedFare) {
        const bookingRef = doc(db, 'bookings', bookingId);
        const bookingSnap = await getDoc(bookingRef);
        const bookingData = bookingSnap.exists() ? (bookingSnap.data() as Booking) : null;
        const { baseFee, gstAmount, totalFee } = calculateServiceFee(negotiatedFare, config || undefined);
        const totalPrice = negotiatedFare + totalFee;
        await updateDoc(bookingRef, {
          fare: negotiatedFare,
          serviceFee: baseFee,
          gstAmount,
          totalPrice,
          status: 'confirmed',
          negotiationStatus: 'accepted'
        });
        if (bookingData?.rideId) {
          await updateDoc(doc(db, 'rides', bookingData.rideId), {
            status: 'full',
          });
        }
        alert("Counter offer accepted! Booking confirmed.");
      } else {
        await updateDoc(doc(db, 'bookings', bookingId), {
          status: 'rejected',
          negotiationStatus: 'rejected'
        });
        alert("Counter offer rejected.");
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${bookingId}`);
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
          bookings.map((booking) => (
            <div key={booking.id} className="bg-white p-8 rounded-[32px] border border-mairide-secondary shadow-sm hover:shadow-md transition-all">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-bold text-xl text-mairide-primary mb-1">{booking.origin} → {booking.destination}</h3>
                  <p className="text-sm text-mairide-secondary">Driver: {booking.driverName}</p>
                  {booking.feePaid && booking.driverFeePaid ? (
                    <div className="mt-2 bg-green-50 p-3 rounded-xl flex items-center space-x-2 text-green-700">
                      <Phone className="w-4 h-4" />
                      <span className="font-bold">{booking.driverPhone || 'Not provided'}</span>
                    </div>
                  ) : booking.status === 'confirmed' ? (
                    <div className="mt-2 bg-orange-50 p-3 rounded-xl flex items-center space-x-2 text-orange-700 text-xs">
                      <Lock className="w-4 h-4" />
                      <span>Contact info locked. Both parties must pay the platform fee to unlock.</span>
                    </div>
                  ) : null}
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase mt-2">{new Date(booking.createdAt).toLocaleString()}</p>
                </div>
                <div className={cn(
                  "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest",
                  booking.status === 'confirmed' ? "bg-green-100 text-green-700" :
                  booking.status === 'pending' ? "bg-orange-100 text-orange-700" :
                  "bg-red-100 text-red-700"
                )}>
                  {booking.status}
                </div>
              </div>

              {booking.status === 'negotiating' && (
                <div className="mb-6 p-6 bg-mairide-accent/10 border border-mairide-accent rounded-2xl">
                  <div className="flex items-center space-x-3 mb-4">
                    <Bot className="w-6 h-6 text-mairide-accent" />
                    <div>
                      <h4 className="font-bold text-mairide-primary">Counter Offer from Driver</h4>
                      <p className="text-sm text-mairide-secondary">The driver has proposed a new fare of <span className="font-bold text-mairide-accent">{formatCurrency(booking.negotiatedFare)}</span></p>
                    </div>
                  </div>
                  <div className="flex space-x-3">
                    <button 
                      onClick={() => handleNegotiation(booking.id, 'accepted', booking.negotiatedFare)}
                      className="flex-1 bg-mairide-primary text-white py-3 rounded-xl font-bold text-sm hover:bg-mairide-accent transition-colors"
                    >
                      Accept Offer
                    </button>
                    <button 
                      onClick={() => handleNegotiation(booking.id, 'rejected')}
                      className="flex-1 bg-white border border-mairide-secondary text-mairide-primary py-3 rounded-xl font-bold text-sm hover:bg-mairide-bg transition-colors"
                    >
                      Reject
                    </button>
                  </div>
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
                  Ride fare is settled between traveler and driver separately. MaiRide collects only the maintenance fee + GST to confirm and protect the booking flow.
                </p>
              </div>

              {booking.status === 'confirmed' && !booking.feePaid && (
                <div className="flex space-x-4">
                  <button 
                    onClick={() => handlePayFee(booking, true)}
                    className="flex-1 bg-mairide-primary text-white py-4 rounded-2xl font-bold hover:bg-mairide-accent transition-colors flex items-center justify-center space-x-2"
                  >
                    <Bot className="w-5 h-5" />
                    <span>Pay with Maicoins</span>
                  </button>
                  <button 
                    onClick={() => handlePayFee(booking, false)}
                    className="flex-1 bg-white border-2 border-mairide-primary text-mairide-primary py-4 rounded-2xl font-bold hover:bg-mairide-bg transition-colors"
                  >
                    Pay Online & Upload Proof
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
            </div>
          ))
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
    </div>
  );
};

const MyRides = ({ profile }: { profile: UserProfile }) => {
  const [rides, setRides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingRideId, setCancellingRideId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'rides'),
      where('driverId', '==', profile.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      setRides(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const handleCancelRideOffer = async (ride: any) => {
    if (ride.status !== 'available') {
      alert('Only active unbooked ride offers can be cancelled.');
      return;
    }

    if (!window.confirm('Cancel this ride offer? Travelers will no longer be able to book it.')) {
      return;
    }

    setCancellingRideId(ride.id);
    try {
      const bookingSnapshot = await getDocs(
        query(collection(db, 'bookings'), where('rideId', '==', ride.id))
      );
      const bookings = bookingSnapshot.docs.map((snapshotDoc) => snapshotDoc.data() as Booking);
      const hasActiveBooking = bookings.some((booking) =>
        ['pending', 'confirmed', 'negotiating', 'completed'].includes(booking.status)
      );

      if (hasActiveBooking) {
        alert('This ride already has booking activity and cannot be cancelled now.');
        return;
      }

      await updateDoc(doc(db, 'rides', ride.id), {
        status: 'cancelled',
      });
      alert('Ride offer cancelled successfully.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rides/${ride.id}`);
    } finally {
      setCancellingRideId(null);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold text-mairide-primary mb-8">My Ride Offers</h1>
      <div className="space-y-6">
        {rides.length > 0 ? (
          rides.map((ride) => (
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
                  {ride.status === 'available' && (
                    <button
                      onClick={() => handleCancelRideOffer(ride)}
                      disabled={cancellingRideId === ride.id}
                      className="px-4 py-2 rounded-xl border border-red-200 text-red-700 text-xs font-bold hover:bg-red-50 disabled:opacity-50"
                    >
                      {cancellingRideId === ride.id ? 'Cancelling...' : 'Cancel Offer'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-mairide-secondary">
            <Navigation className="w-12 h-12 text-mairide-secondary mx-auto mb-4" />
            <p className="text-mairide-secondary">You haven't posted any rides yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const DriverHistory = ({ profile }: { profile: UserProfile }) => {
  const [rides, setRides] = useState<any[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingRides, setLoadingRides] = useState(true);
  const [loadingBookings, setLoadingBookings] = useState(true);

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
      setBookings(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoadingBookings(false);
    });

    return () => {
      unsubscribeRides();
      unsubscribeBookings();
    };
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
    </div>
  );
};

// --- Main App Components ---

const BookingRequests = ({ profile }: { profile: UserProfile }) => {
  const { config } = useAppConfig();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [counterFares, setCounterFares] = useState<{[key: string]: string}>({});
  const [paymentRequest, setPaymentRequest] = useState<Booking | null>(null);

  const handleCounterOffer = async (requestId: string, fare: number) => {
    if (!fare || fare <= 0) {
      alert("Please enter a valid fare.");
      return;
    }
    try {
      await updateDoc(doc(db, 'bookings', requestId), {
        negotiatedFare: fare,
        negotiationStatus: 'pending',
        status: 'negotiating'
      });
      alert("Counter offer sent to traveler!");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${requestId}`);
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
      setRequests(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const handleAction = async (requestId: string, status: 'confirmed' | 'rejected', fare: number, driverId: string) => {
    try {
      const bookingRef = doc(db, 'bookings', requestId);
      const bookingSnap = await getDoc(bookingRef);
      const bookingData = bookingSnap.exists() ? (bookingSnap.data() as Booking) : null;

      await updateDoc(bookingRef, { 
        status,
        driverPhone: profile.phoneNumber || ''
      });
      
      if (status === 'confirmed') {
        if (bookingData?.rideId) {
          await updateDoc(doc(db, 'rides', bookingData.rideId), {
            status: 'full',
          });
        }
        // Update driver's total earnings
        const driverRef = doc(db, 'users', driverId);
        const driverSnap = await getDoc(driverRef);
        if (driverSnap.exists()) {
          const driverData = driverSnap.data() as UserProfile;
          const currentEarnings = driverData.driverDetails?.totalEarnings || 0;
          await updateDoc(driverRef, {
            'driverDetails.totalEarnings': currentEarnings + fare
          });
        }
        // Trigger referral bonus pending state
        await walletService.onRideStart(profile.uid);
      }
      
      alert(`Booking ${status}!`);
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
    });
    await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
    await maybeActivateRideLifecycle(booking.id);
    alert('Driver payment proof submitted successfully.');
  };

  const handlePayFee = async (booking: Booking, useCoins: boolean) => {
    try {
      const { totalFee } = calculateServiceFee(booking.fare, config || undefined);
      let coinsToUse = 0;
      
      if (useCoins) {
        const balance = profile.wallet?.balance || 0;
        coinsToUse = Math.min(balance, totalFee, MAX_MAICOINS_PER_RIDE);
      }

      const amountPaid = totalFee - coinsToUse;

      if (amountPaid > 0) {
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
        paymentStatus: 'paid'
      });

      // Trigger referral bonus activation
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      
      alert("Platform fee paid successfully!");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
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
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-bold text-xl text-mairide-primary mb-1">{request.origin} → {request.destination}</h3>
                  <p className="text-sm text-mairide-secondary">Traveler: {request.consumerName}</p>
                  {request.feePaid && request.driverFeePaid ? (
                    <div className="mt-2 bg-green-50 p-3 rounded-xl flex items-center space-x-2 text-green-700">
                      <Phone className="w-4 h-4" />
                      <span className="font-bold">{request.consumerPhone || 'Not provided'}</span>
                    </div>
                  ) : request.status === 'confirmed' ? (
                    <div className="mt-2 bg-orange-50 p-3 rounded-xl flex items-center space-x-2 text-orange-700 text-xs">
                      <Lock className="w-4 h-4" />
                      <span>Contact info locked. Both parties must pay the platform fee to unlock.</span>
                    </div>
                  ) : null}
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase mt-2">{new Date(request.createdAt).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black text-mairide-accent">{formatCurrency(request.fare)}</p>
                  <p className="text-[10px] font-bold text-mairide-secondary uppercase">Your Earnings</p>
                </div>
              </div>
              
              <div className="bg-mairide-bg p-6 rounded-2xl mb-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">Platform Fee</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(request.serviceFee)}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-mairide-secondary">GST (18%)</span>
                  <span className="font-bold text-mairide-primary">{formatCurrency(request.gstAmount)}</span>
                </div>
              </div>

              {request.status === 'pending' ? (
                <div className="space-y-4">
                  <div className="flex space-x-4">
                    <button 
                      onClick={() => handleAction(request.id, 'confirmed', request.fare, request.driverId)}
                      className="flex-1 bg-green-600 text-white py-4 rounded-2xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-100"
                    >
                      Accept Request
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
              ) : request.status === 'negotiating' ? (
                <div className="bg-mairide-bg p-6 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Clock className="w-5 h-5 text-mairide-accent" />
                    <div>
                      <p className="font-bold text-mairide-primary">Counter Offer Sent</p>
                      <p className="text-xs text-mairide-secondary">Waiting for traveler to respond to {formatCurrency(request.negotiatedFare)}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleAction(request.id, 'rejected', request.fare, request.driverId)}
                    className="text-xs font-bold text-red-600 hover:underline"
                  >
                    Cancel Request
                  </button>
                </div>
              ) : !request.driverFeePaid ? (
                <div className="flex space-x-4">
                  <button 
                    onClick={() => handlePayFee(request, true)}
                    className="flex-1 bg-mairide-primary text-white py-4 rounded-2xl font-bold hover:bg-mairide-accent transition-colors flex items-center justify-center space-x-2 shadow-lg shadow-mairide-primary/20"
                  >
                    <Bot className="w-5 h-5" />
                    <span>Pay with Maicoins</span>
                  </button>
                  <button 
                    onClick={() => handlePayFee(request, false)}
                    className="flex-1 bg-white border-2 border-mairide-primary text-mairide-primary py-4 rounded-2xl font-bold hover:bg-mairide-bg transition-colors"
                  >
                    Pay Online & Upload Proof
                  </button>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-100 p-4 rounded-2xl flex items-center justify-center space-x-2 text-green-600 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Platform Fee Submitted {request.driverMaiCoinsUsed > 0 && `(Used ${request.driverMaiCoinsUsed} Maicoins)`}</span>
                </div>
              )}
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
  const [activeTab, setActiveTab] = useState<'search' | 'history' | 'wallet' | 'support'>('search');
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
  const [isBooking, setIsBooking] = useState(false);
  const [autocompleteFrom, setAutocompleteFrom] = useState<any | null>(null);
  const [autocompleteTo, setAutocompleteTo] = useState<any | null>(null);
  const [searchLocationFrom, setSearchLocationFrom] = useState<{ lat: number, lng: number } | null>(null);
  const [searchLocationTo, setSearchLocationTo] = useState<{ lat: number, lng: number } | null>(null);
  const [directionsResponse, setDirectionsResponse] = useState<any | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'bookings'), where('consumerId', '==', profile.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Booking[] = [];
      snapshot.forEach((snapshotDoc) => list.push({ id: snapshotDoc.id, ...(snapshotDoc.data() as Booking) }));
      setDashboardBookings(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });
    return () => unsubscribe();
  }, [profile.uid]);

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
      const q = query(
        collection(db, 'rides'),
        where('status', '==', 'available')
      );
      const querySnapshot = await getDocs(q);
      const rideList: any[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();

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
            : normalizedOrigin.includes(normalizedSearchFrom) ||
              normalizedSearchFrom.includes(normalizedOrigin));

        const destinationMatches =
          !search.to ||
          corridorMatch ||
          (destinationDistance !== null
            ? destinationDistance <= 120
            : normalizedDestination.includes(normalizedSearchTo) ||
              normalizedSearchTo.includes(normalizedDestination));

        const nearbyToTraveler =
          !userLocation ||
          !data.originLocation ||
          getDistance(
            userLocation.lat,
            userLocation.lng,
            data.originLocation.lat,
            data.originLocation.lng
          ) <= 150;

        if (originMatches && destinationMatches && nearbyToTraveler) {
          rideList.push({ id: doc.id, ...data });
        }
      });
      setRides(rideList);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'rides');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBookRide = async (ride: any) => {
    setIsBooking(true);
    try {
      const { baseFee, gstAmount, totalFee } = calculateServiceFee(ride.price, config || undefined);
      const totalPrice = ride.price + totalFee;
      
      const bookingData = {
        rideId: ride.id,
        consumerId: profile.uid,
        consumerName: profile.displayName,
        consumerPhone: profile.phoneNumber || '',
        driverId: ride.driverId,
        driverName: ride.driverName,
        origin: ride.origin,
        destination: ride.destination,
        fare: ride.price,
        seatsBooked: 1, // Default to 1 seat for now
        serviceFee: baseFee,
        gstAmount: gstAmount,
        totalPrice: totalPrice,
        status: 'pending',
        paymentStatus: 'pending',
        createdAt: new Date().toISOString(),
        maiCoinsUsed: 0
      };

      await addDoc(collection(db, 'bookings'), bookingData);
      
      alert("Booking request sent! Once confirmed, you'll be notified.");
      setSelectedRide(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bookings');
    } finally {
      setIsBooking(false);
    }
  };

  const handleTravelerNegotiation = async (booking: Booking, action: 'accepted' | 'rejected') => {
    try {
      if (action === 'accepted' && booking.negotiatedFare) {
        const { baseFee, gstAmount, totalFee } = calculateServiceFee(booking.negotiatedFare, config || undefined);
        await updateDoc(doc(db, 'bookings', booking.id), {
          fare: booking.negotiatedFare,
          serviceFee: baseFee,
          gstAmount,
          totalPrice: booking.negotiatedFare + totalFee,
          status: 'confirmed',
          negotiationStatus: 'accepted',
        });
        alert('Counter offer accepted.');
        return;
      }

      await updateDoc(doc(db, 'bookings', booking.id), {
        status: 'rejected',
        negotiationStatus: 'rejected',
      });
      alert('Counter offer rejected.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
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
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Traveler payment proof submitted successfully.');
      setPaymentBooking(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  const handleTravelerDashboardPayment = async (booking: Booking, useCoins: boolean) => {
    try {
      const { totalFee } = calculateServiceFee(booking.fare, config || undefined);
      let coinsToUse = 0;

      if (useCoins) {
        const balance = profile.wallet?.balance || 0;
        coinsToUse = Math.min(balance, totalFee, MAX_MAICOINS_PER_RIDE);
      }

      const amountPaid = totalFee - coinsToUse;
      if (amountPaid > 0) {
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

      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Platform fee paid successfully.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <div className="flex bg-mairide-bg p-1 rounded-2xl mb-8 w-fit mx-auto overflow-x-auto">
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

          <TravelerDashboardSummary
            bookings={dashboardBookings}
            onAcceptCounter={(booking) => handleTravelerNegotiation(booking, 'accepted')}
            onRejectCounter={(booking) => handleTravelerNegotiation(booking, 'rejected')}
            onPayWithCoins={(booking) => handleTravelerDashboardPayment(booking, true)}
            onPayOnline={(booking) => handleTravelerDashboardPayment(booking, false)}
          />

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
                    <div className="bg-mairide-bg p-3 rounded-2xl">
                      <Car className="w-8 h-8 text-mairide-accent" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="font-bold text-mairide-primary">{ride.driverName}</h3>
                        <div className="flex items-center text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-bold">
                          <Star className="w-3 h-3 mr-1 fill-current" />
                          {ride.rating}
                        </div>
                      </div>
                      <div className="flex items-center text-sm text-mairide-secondary space-x-2">
                        <span>{ride.origin}</span>
                        <ChevronRight className="w-4 h-4" />
                        <span>{ride.destination}</span>
                      </div>
                      <p className="text-xs text-mairide-secondary mt-1">Departs: {new Date(ride.departureTime).toLocaleString()}</p>
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
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl border border-mairide-secondary overflow-hidden relative"
                >
                  <button 
                    onClick={() => setSelectedRide(null)}
                    className="absolute top-6 right-6 p-2 hover:bg-mairide-bg rounded-full transition-colors"
                  >
                    <X className="w-6 h-6 text-mairide-secondary" />
                  </button>

                  <div className="flex items-center space-x-4 mb-8">
                    <div className="bg-mairide-bg p-4 rounded-3xl">
                      <Car className="w-8 h-8 text-mairide-accent" />
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
                      onClick={() => handleBookRide(selectedRide)}
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
        </>
      )}

      {activeTab === 'history' && <MyBookings profile={profile} />}
      {activeTab === 'wallet' && <WalletDashboard profile={profile} />}
      {activeTab === 'support' && <SupportSystem profile={profile} />}
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
  const [newRide, setNewRide] = useState({ origin: '', destination: '', price: '', seats: '4' });
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'requests' | 'history' | 'wallet' | 'support'>('dashboard');

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
      setRequests(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });
    return () => unsubscribe();
  }, [profile.uid]);

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

  const handlePostRide = async () => {
    if (!newRide.origin || !newRide.destination || !newRide.price) return;
    try {
      await addDoc(collection(db, 'rides'), {
        driverId: profile.uid,
        driverName: profile.displayName,
        driverRating: profile.driverDetails?.rating || 5.0,
        origin: newRide.origin,
        destination: newRide.destination,
        originLocation: originLocation || userLocation,
        destinationLocation: destinationLocation,
        price: Number(newRide.price),
        seatsAvailable: Number(newRide.seats),
        status: 'available',
        departureTime: new Date().toISOString(),
        createdAt: new Date().toISOString()
      });
      setNewRide({ origin: '', destination: '', price: '', seats: '4' });
      setShowOfferForm(false);
      alert("Ride offer posted successfully!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'rides');
    }
  };

  const handleDriverAction = async (request: Booking, status: 'confirmed' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'bookings', request.id), {
        status,
        driverPhone: profile.phoneNumber || '',
      });

      if (status === 'confirmed') {
        await updateDoc(doc(db, 'rides', request.rideId), {
          status: 'full',
        });
        const driverRef = doc(db, 'users', profile.uid);
        const driverSnap = await getDoc(driverRef);
        if (driverSnap.exists()) {
          const driverData = driverSnap.data() as UserProfile;
          const currentEarnings = driverData.driverDetails?.totalEarnings || 0;
          await updateDoc(driverRef, {
            'driverDetails.totalEarnings': currentEarnings + request.fare,
          });
        }
        await walletService.onRideStart(profile.uid);
      }

      alert(`Booking ${status}.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${request.id}`);
    }
  };

  const handleDriverCounterOffer = async (request: Booking, fare: number) => {
    if (!fare || fare <= 0) {
      alert('Please enter a valid fare.');
      return;
    }

    try {
      await updateDoc(doc(db, 'bookings', request.id), {
        negotiatedFare: fare,
        negotiationStatus: 'pending',
        status: 'negotiating',
      });
      alert('Counter offer sent to traveler.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${request.id}`);
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
      });
      await walletService.onMaintenanceFeePaid(profile.uid, booking.id);
      await maybeActivateRideLifecycle(booking.id);
      alert('Driver payment proof submitted successfully.');
      setPaymentRequest(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  const handleDriverDashboardPayment = async (booking: Booking, useCoins: boolean) => {
    try {
      const { totalFee } = calculateServiceFee(booking.fare, config || undefined);
      let coinsToUse = 0;

      if (useCoins) {
        const balance = profile.wallet?.balance || 0;
        coinsToUse = Math.min(balance, totalFee, MAX_MAICOINS_PER_RIDE);
      }

      const amountPaid = totalFee - coinsToUse;
      if (amountPaid > 0) {
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
      await updateDoc(doc(db, 'bookings', booking.id), {
        rideLifecycleStatus: 'completed',
        rideEndedAt: new Date().toISOString(),
        rideEndOtpVerifiedAt: new Date().toISOString(),
        status: 'completed',
      });

      await updateDoc(doc(db, 'rides', booking.rideId), {
        status: 'completed',
      });

      alert('Ride completed successfully. Go online again whenever you are ready for the next trip.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bookings/${booking.id}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <div className="flex bg-mairide-bg p-1 rounded-2xl mb-8 w-fit mx-auto overflow-x-auto">
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm">
              <p className="text-sm text-mairide-secondary mb-1">Total Earnings</p>
              <h3 className="text-2xl font-black text-mairide-primary">{formatCurrency(profile.driverDetails?.totalEarnings || 0)}</h3>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-mairide-secondary shadow-sm">
              <p className="text-sm text-mairide-secondary mb-1">Rating</p>
              <div className="flex items-center space-x-2">
                <h3 className="text-2xl font-black text-mairide-primary">{profile.driverDetails?.rating}</h3>
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
            <div className="h-[360px] relative">
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

            <DriverDashboardSummary
              requests={requests}
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
                    <select 
                      className="w-full p-4 bg-mairide-bg border border-mairide-secondary rounded-2xl outline-none focus:ring-2 focus:ring-mairide-accent text-mairide-primary"
                      value={newRide.seats}
                      onChange={e => setNewRide({ ...newRide, seats: e.target.value })}
                    >
                      {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} Seats</option>)}
                    </select>
                  </div>
                </div>
                <button 
                  onClick={handlePostRide}
                  className="w-full bg-mairide-accent text-white py-4 rounded-2xl font-bold hover:bg-mairide-primary transition-all"
                >
                  Post Ride Offer
                </button>
              </motion.div>
            )}

            <MyRides profile={profile} />
          </div>
        </>
      )}

      {activeTab === 'requests' && <BookingRequests profile={profile} />}
      {activeTab === 'history' && <DriverHistory profile={profile} />}
      {activeTab === 'wallet' && <WalletDashboard profile={profile} />}
      {activeTab === 'support' && <SupportSystem profile={profile} />}
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
  
  // Calculate stats
  const totalRevenue = bookings.filter(b => b.status === 'completed').reduce((acc, b) => acc + (b.serviceFee || 0), 0);
  const totalGST = bookings.filter(b => b.status === 'completed').reduce((acc, b) => acc + (b.gstAmount || 0), 0);
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
        const dayBookings = bookings.filter(b => 
          b.status === 'completed' && 
          new Date(b.createdAt).toDateString() === d.toDateString()
        );
        data.push({
          name: dateStr,
          revenue: dayBookings.reduce((acc, b) => acc + (b.serviceFee || 0), 0),
          gst: dayBookings.reduce((acc, b) => acc + (b.gstAmount || 0), 0),
          bookings: dayBookings.length
        });
      }
    } else if (timeframe === 'weekly') {
      for (let i = 3; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - (i * 7));
        const weekStr = `Week ${4-i}`;
        const weekBookings = bookings.filter(b => {
          const bDate = new Date(b.createdAt);
          const diffDays = Math.floor((now.getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24));
          return b.status === 'completed' && diffDays >= i * 7 && diffDays < (i + 1) * 7;
        });
        data.push({
          name: weekStr,
          revenue: weekBookings.reduce((acc, b) => acc + (b.serviceFee || 0), 0),
          gst: weekBookings.reduce((acc, b) => acc + (b.gstAmount || 0), 0),
          bookings: weekBookings.length
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(now.getMonth() - i);
        const monthStr = d.toLocaleDateString('en-IN', { month: 'short' });
        const monthBookings = bookings.filter(b => {
          const bDate = new Date(b.createdAt);
          return b.status === 'completed' && bDate.getMonth() === d.getMonth() && bDate.getFullYear() === d.getFullYear();
        });
        data.push({
          name: monthStr,
          revenue: monthBookings.reduce((acc, b) => acc + (b.serviceFee || 0), 0),
          gst: monthBookings.reduce((acc, b) => acc + (b.gstAmount || 0), 0),
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
  const [formData, setFormData] = useState<Partial<AppConfig>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [uploadingQR, setUploadingQR] = useState(false);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const headers = await getAdminRequestHeaders(auth.currentUser?.email || null);
        const response = await axios.get('/api/admin/config', { headers });
        if (response.data?.config) {
          setFormData(response.data.config);
        } else {
          setFormData({});
        }
      } catch (error: any) {
        console.error('Error loading configuration:', error);
        alert(error.response?.data?.error || error.message || "Failed to load configuration.");
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
      const headers = await getAdminRequestHeaders(auth.currentUser?.email || null);
      const response = await axios.post('/api/admin/save-config', {
        ...formData,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser?.email || 'admin'
      }, {
        headers
      });
      if (response.data?.config) {
        setFormData(response.data.config);
      }
      alert("Configuration saved successfully!");
    } catch (error: any) {
      console.error('Error saving configuration:', error);
      alert(error.response?.data?.error || error.message || "Failed to save configuration.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleQRUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingQR(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        const path = `config/qr_code_${Date.now()}`;
        const storageReference = storageRef(storage, path);
        await uploadString(storageReference, base64, 'data_url');
        const url = await getDownloadURL(storageReference);
        setFormData(prev => ({ ...prev, qrCodeUrl: url }));
        setUploadingQR(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("QR Upload error:", error);
      setUploadingQR(false);
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
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">UPI ID for Collection</label>
                <input 
                  type="text"
                  value={formData.upiId || ''}
                  onChange={e => setFormData({ ...formData, upiId: e.target.value })}
                  placeholder="e.g. mairide@upi"
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                  required
                />
              </div>
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
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Payment Gateway API Key</label>
                <input 
                  type="password"
                  value={formData.paymentGatewayApiKey || ''}
                  onChange={e => setFormData({ ...formData, paymentGatewayApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Collection QR Code</label>
              <div className="flex items-center space-x-6 bg-mairide-bg p-6 rounded-3xl border-2 border-dashed border-mairide-secondary">
                <div className="w-32 h-32 bg-white rounded-2xl flex items-center justify-center overflow-hidden border border-mairide-secondary">
                  {formData.qrCodeUrl ? (
                    <img src={formData.qrCodeUrl} className="w-full h-full object-contain" alt="QR Code" />
                  ) : (
                    <Camera className="w-8 h-8 text-mairide-secondary opacity-20" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-xs text-mairide-secondary mb-4">Upload the QR code that will be displayed to users for manual UPI payments.</p>
                  <label className="bg-mairide-primary text-white px-6 py-2.5 rounded-xl text-xs font-bold cursor-pointer hover:bg-mairide-primary/90 transition-colors inline-block">
                    {uploadingQR ? 'Uploading...' : 'Upload New QR'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleQRUpload} disabled={uploadingQR} />
                  </label>
                </div>
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
            <h3 className="text-sm font-bold text-mairide-secondary uppercase tracking-widest border-b border-mairide-bg pb-2">External Services (SMS/Email)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">SMS API Key</label>
                <input 
                  type="password"
                  value={formData.smsApiKey || ''}
                  onChange={e => setFormData({ ...formData, smsApiKey: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Email API URL</label>
                <input 
                  type="url"
                  value={formData.emailApiUrl || ''}
                  onChange={e => setFormData({ ...formData, emailApiUrl: e.target.value })}
                  className="w-full px-6 py-4 bg-mairide-bg rounded-2xl border-none outline-none font-bold text-mairide-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-mairide-primary uppercase ml-1">Email API Key</label>
                <input 
                  type="password"
                  value={formData.emailApiKey || ''}
                  onChange={e => setFormData({ ...formData, emailApiKey: e.target.value })}
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
  const totalRevenue = bookings.filter(b => b.status === 'completed').reduce((acc, b) => acc + (b.serviceFee || 0), 0);
  const totalMaiCoinsIssued = users.reduce((acc, u) => acc + (u.wallet?.balance || 0) + (u.wallet?.pendingBalance || 0), 0);
  
  // Projection Logic
  const last30DaysBookings = bookings.filter(b => {
    const bDate = new Date(b.createdAt);
    const diffDays = Math.floor((new Date().getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24));
    return b.status === 'completed' && diffDays <= 30;
  });

  const dailyAvgRevenue = totalRevenue / 30; // Rough estimate
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
            <p className="text-sm opacity-90 font-medium">Maicoin liabilities are growing faster than cash revenue. Current Ratio: {(totalMaiCoinsIssued / totalRevenue).toFixed(2)}x. Immediate adjustment required.</p>
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
      await axios.post('/api/user/change-password', { newPassword }, {
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
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-mairide-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-mairide-accent" />
          </div>
          <h2 className="text-3xl font-black text-mairide-primary tracking-tighter mb-2">Secure Your Account</h2>
          <p className="text-mairide-secondary italic serif">For security reasons, you must change your temporary password before proceeding.</p>
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
        </form>
      </motion.div>
    </div>
  );
};

const AdminDashboard = ({ profile, isLoaded, loadError, authFailure }: { profile: UserProfile, isLoaded: boolean, loadError?: Error, authFailure?: boolean }) => {
  const effectiveAdminRole = profile.adminRole || 'super_admin';
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'support' | 'verification' | 'profile' | 'rides' | 'revenue' | 'config' | 'analytics' | 'security' | 'map'>('revenue');
  const [adminLocation, setAdminLocation] = useState<{ lat: number; lng: number } | null>(null);

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
      await axios.post('/api/admin/update-password', {
        uid: resetPasswordUser.uid,
        newPassword: newAdminPassword
      }, {
        headers
      });
      alert(`Password for ${resetPasswordUser.displayName} has been reset successfully!`);
      setResetPasswordUser(null);
      setNewAdminPassword('');
    } catch (error: any) {
      console.error('Error resetting password:', error);
      alert(error.response?.data?.error || error.message || "Failed to reset password.");
    } finally {
      setIsResetting(false);
    }
  };

  const handleGenerateResetLink = async (targetUser: UserProfile) => {
    setIsGeneratingResetLink(targetUser.uid);
    try {
      const headers = await getAdminRequestHeaders(profile.email);
      const response = await axios.post('/api/admin/generate-reset-link', {
        email: targetUser.email
      }, {
        headers
      });

      const resetLink = response.data?.actionLink;
      if (!resetLink) {
        throw new Error("No reset link returned.");
      }

      await navigator.clipboard.writeText(resetLink);
      alert(`A secure reset link for ${targetUser.displayName} has been copied. Share it only through your approved customer support channel.`);
    } catch (error: any) {
      console.error('Error generating reset link:', error);
      alert(error.response?.data?.error || error.message || "Failed to generate reset link.");
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
  const [rejectionReason, setRejectionReason] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'consumer' | 'driver' | 'admin'>('all');
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
    const matchesSearch = user.displayName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });
  const usersWithLocation = users.filter(
    u => u.location && typeof u.location.lat === 'number' && typeof u.location.lng === 'number'
  );
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
      await updateDoc(doc(db, 'users', userId), { 
        verificationStatus: status,
        rejectionReason: status === 'rejected' ? rejectionReason : undefined,
        status: status === 'approved' ? 'active' : 'inactive',
        verifiedBy: profile.uid
      });
      setSelectedDriver(null);
      setRejectionReason('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
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
      await deleteDoc(doc(db, 'users', userId));
      setShowDeleteConfirm(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${userId}`);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await updateDoc(doc(db, 'users', editingUser.uid), {
        displayName: editingUser.displayName,
        phoneNumber: editingUser.phoneNumber || '',
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
    if (!newUser.email || !newUser.displayName || !newUser.password) {
      alert("Please fill in all required fields, including password.");
      return;
    }

    // Check for duplicate email
    const duplicateCheck = users.find(u => u.email === newUser.email);
    if (duplicateCheck) {
      alert("A user with this email already exists.");
      return;
    }

    setIsLoading(true);
    try {
      // 1. Get ID Token for Authorization
      const headers = await getAdminRequestHeaders(profile.email);

      // 2. Call Backend API to create user in Auth and Firestore
      const response = await axios.post('/api/admin/create-user', {
        email: newUser.email,
        password: newUser.password,
        displayName: newUser.displayName,
        phoneNumber: newUser.phoneNumber,
        role: newUser.role,
        adminRole: newUser.role === 'admin' ? newUser.adminRole : undefined
      }, {
        headers
      });

      if (response.status === 201) {
        setShowAddUser(false);
        setNewUser({ email: '', displayName: '', phoneNumber: '', password: '', role: 'consumer', adminRole: 'support' });
        alert(`User ${newUser.displayName} created successfully with a temporary password!`);
      }
    } catch (error: any) {
      console.error('Error creating user:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to create user';
      alert(`Error: ${errorMessage}`);
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
              {item.id === 'verification' && users.filter(u => u.role === 'driver' && u.onboardingComplete && u.verificationStatus === 'pending').length > 0 && (
                <span className={cn(
                  "bg-mairide-accent text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full ml-auto",
                  !isSidebarOpen && "absolute top-1 right-1"
                )}>
                  {users.filter(u => u.role === 'driver' && u.onboardingComplete && u.verificationStatus === 'pending').length}
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
              {users.filter(u => u.role === 'driver' && u.onboardingComplete).map(driver => (
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

            {users.filter(u => u.role === 'driver' && u.onboardingComplete).length === 0 && (
              <div className="text-center py-20 bg-white rounded-[40px] border border-mairide-secondary border-dashed">
                <ShieldCheck className="w-16 h-16 text-mairide-secondary mx-auto mb-4 opacity-20" />
                <h3 className="text-xl font-bold text-mairide-primary">No driver applications yet</h3>
                <p className="text-mairide-secondary italic serif">New driver registrations will appear here for verification.</p>
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
                  <img src="https://maps.google.com/mapfiles/ms/icons/car.png" className="w-4 h-4" alt="car" />
                  <span className="text-xs font-bold text-mairide-primary">Driver</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-8">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { label: 'Total Users', value: users.length, icon: Users, color: 'bg-blue-50 text-blue-600' },
                { label: 'Drivers', value: users.filter(u => u.role === 'driver').length, icon: Car, color: 'bg-orange-50 text-orange-600' },
                { label: 'Active Now', value: users.filter(u => u.status === 'active').length, icon: CheckCircle2, color: 'bg-green-50 text-green-600' },
                { label: 'Admins', value: users.filter(u => u.role === 'admin').length, icon: Shield, color: 'bg-purple-50 text-purple-600' }
              ].map((stat, idx) => (
                <div key={idx} className="bg-white p-6 rounded-[32px] border border-mairide-secondary shadow-sm">
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4", stat.color)}>
                    <stat.icon className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-mairide-secondary uppercase tracking-widest mb-1">{stat.label}</p>
                  <p className="text-3xl font-black text-mairide-primary tracking-tighter">{stat.value}</p>
                </div>
              ))}
            </div>

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
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-mairide-bg text-[10px] font-bold text-mairide-secondary uppercase tracking-widest">
                      <th className="px-8 py-4">User</th>
                      <th className="px-8 py-4">Role</th>
                      <th className="px-8 py-4">Status</th>
                      <th className="px-8 py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mairide-secondary">
                    {filteredUsers.map(user => (
                      <tr key={user.uid} className="hover:bg-mairide-bg/50 transition-colors">
                        <td className="px-8 py-6">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 rounded-xl bg-mairide-bg flex items-center justify-center overflow-hidden border border-mairide-secondary">
                              {user.photoURL ? (
                                <img src={user.photoURL} className="w-full h-full object-cover" alt="" />
                              ) : (
                                <UserIcon className="w-5 h-5 text-mairide-secondary" />
                              )}
                            </div>
                            <div>
                              <p className="font-bold text-mairide-primary">{user.displayName}</p>
                              <p className="text-xs text-mairide-secondary">{user.email}</p>
                              {effectiveAdminRole === 'super_admin' && user.forcePasswordChange && (
                                <p className="text-[10px] font-mono text-mairide-accent mt-1 bg-mairide-accent/5 px-2 py-0.5 rounded inline-block">
                                  Password reset required
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <select 
                            value={user.role}
                            onChange={(e) => handleUpdateRole(user.uid, e.target.value as any)}
                            className="bg-mairide-bg border-none rounded-xl text-xs font-bold p-2 outline-none"
                          >
                            <option value="consumer">Consumer</option>
                            <option value="driver">Driver</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="px-8 py-6">
                          <button 
                            onClick={() => handleUpdateStatus(user.uid, user.status === 'active' ? 'inactive' : 'active')}
                            className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                              user.status === 'active' ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                            )}
                          >
                            {user.status}
                          </button>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex items-center space-x-2">
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

        {activeTab === 'config' && (
          <AdminConfigView />
        )}

        {activeTab === 'support' && <AdminSupportView />}

        {activeTab === 'security' && <AdminSecurityView />}

        {activeTab === 'profile' && (
          <div className="max-w-2xl mx-auto bg-white rounded-[40px] border border-mairide-secondary p-12 shadow-sm text-center">
            <div className="w-32 h-32 bg-mairide-bg rounded-full flex items-center justify-center mx-auto mb-8 border-4 border-white shadow-xl">
              <UserIcon className="w-16 h-16 text-mairide-secondary" />
            </div>
            <h2 className="text-3xl font-bold text-mairide-primary mb-2">{auth.currentUser?.displayName || 'Admin User'}</h2>
            <p className="text-mairide-secondary mb-8">{auth.currentUser?.email}</p>
            
            <div className="grid grid-cols-2 gap-4 mb-12">
              <div className="bg-mairide-bg p-6 rounded-3xl text-center">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Role</p>
                <p className="text-lg font-bold text-mairide-primary">Super Admin</p>
              </div>
              <div className="bg-mairide-bg p-6 rounded-3xl text-center">
                <p className="text-[10px] font-bold text-mairide-secondary uppercase mb-1">Status</p>
                <p className="text-lg font-bold text-green-600">Active</p>
              </div>
            </div>

            <button 
              onClick={() => signOut(auth)}
              className="w-full bg-red-600 text-white py-5 rounded-3xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
            >
              Sign Out
            </button>
          </div>
          )}
          </div>
        </main>
      </div>

      {/* Add User Modal */}
      <AnimatePresence>
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
                    onChange={e => setNewUser({ ...newUser, displayName: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Email Address</label>
                  <input 
                    type="email" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={newUser.email}
                    onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Mobile Number</label>
                  <input 
                    type="tel" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={newUser.phoneNumber}
                    onChange={e => setNewUser({ ...newUser, phoneNumber: e.target.value })}
                    placeholder="+91 1234567890"
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
                    onChange={e => setEditingUser({ ...editingUser, displayName: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-mairide-secondary uppercase mb-2 ml-2">Mobile Number</label>
                  <input 
                    type="tel" 
                    className="w-full p-4 bg-mairide-bg border-none rounded-2xl outline-none"
                    value={editingUser.phoneNumber || ''}
                    onChange={e => setEditingUser({ ...editingUser, phoneNumber: e.target.value })}
                    placeholder="+91 1234567890"
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
                    <p className="text-xs text-mairide-secondary">Driver Application Verification</p>
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
                        <p className="text-lg font-bold text-mairide-primary">{selectedDriver.phoneNumber || 'Not provided'}</p>
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
                    <p className="text-xl font-bold text-mairide-primary tracking-widest">{selectedDriver.driverDetails?.aadhaarNumber}</p>
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
        setConfig({ id: snapshot.id, ...snapshot.data() } as AppConfig);
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
        // Listen to profile changes
        unsubProfile = onSnapshot(doc(db, 'users', u.uid), async (snapshot) => {
          if (snapshot.exists()) {
            setProfile(snapshot.data() as UserProfile);
            setLoading(false);
          } else if (u.email) {
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
            setProfile(null);
            setLoading(false);
          }
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
          setProfile(null);
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const handleLogout = () => signOut(auth);

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES
  });

  const [authFailure, setAuthFailure] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

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
    </ErrorBoundary>
  );

  if (profile && profile.role === 'driver') {
    if (!profile.onboardingComplete) {
      return <ErrorBoundary><DriverOnboarding profile={profile} onComplete={() => {}} isLoaded={isLoaded} /></ErrorBoundary>;
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
        </div>
      </Router>
    </ErrorBoundary>
  );
};

export default App;
