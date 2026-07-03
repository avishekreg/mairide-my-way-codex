import { supabase } from '../lib/supabase';
import type { B2BPartner, PartnerBooking, PartnerType, ApprovalStatus, Ride, UserProfile, Booking } from '../types';

type PartnerApplicationInput = {
  authUserId?: string | null;
  businessName: string;
  type: PartnerType;
  gstNumber?: string | null;
  contactPerson: string;
  phone: string;
  email: string;
  documentUrl: string;
  signupLatitude?: number | null;
  signupLongitude?: number | null;
};

type PartnerBookingInput = {
  partnerId: string;
  rideId?: string | null;
  totalFare: number;
  partnerCut: number;
  driverCut: number;
  settlementStatus?: string;
  data?: PartnerBooking['data'];
};

type HotelDeskBookingInput = {
  partnerId: string;
  rideId: string;
  guestName: string;
  guestPhone: string;
  pickup: string;
  dropoff: string;
  pickupTime?: string;
  commissionPercentage: number;
  notes?: string;
};

const normalizeText = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenizeText = (value: string) =>
  normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const normalizePartnerRow = (row: any): B2BPartner => ({
  id: String(row.id),
  authUserId: row.auth_user_id || null,
  businessName: String(row.business_name || ''),
  type: row.type as PartnerType,
  gstNumber: row.gst_number || null,
  contactPerson: String(row.contact_person || ''),
  phone: String(row.phone || ''),
  email: String(row.email || ''),
  documentUrl: String(row.document_url || ''),
  signupLatitude: row.signup_latitude == null ? null : Number(row.signup_latitude),
  signupLongitude: row.signup_longitude == null ? null : Number(row.signup_longitude),
  commissionPercentage: Number(row.commission_percentage || 0),
  razorpayLinkedAccountId: row.razorpay_linked_account_id || null,
  status: (row.status || 'pending') as ApprovalStatus,
  verifiedAt: row.verified_at || null,
  createdAt: String(row.created_at || new Date().toISOString()),
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  data: row.data && typeof row.data === 'object' ? row.data : {},
});

const normalizePartnerBookingRow = (row: any): PartnerBooking => ({
  id: String(row.id),
  partnerId: String(row.partner_id || ''),
  rideId: row.ride_id ? String(row.ride_id) : null,
  totalFare: Number(row.total_fare || 0),
  partnerCut: Number(row.partner_cut || 0),
  driverCut: Number(row.driver_cut || 0),
  settlementStatus: String(row.settlement_status || 'pending') as PartnerBooking['settlementStatus'],
  createdAt: String(row.created_at || new Date().toISOString()),
  updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  data: row.data && typeof row.data === 'object' ? row.data : {},
});

const normalizeRideRow = (row: any): Ride => {
  const base = row.data && typeof row.data === 'object' ? row.data : {};
  return {
    ...base,
    id: String(row.id),
    driverId: String(row.driver_id || base.driverId || ''),
    driverName: String(base.driverName || ''),
    origin: String(base.origin || ''),
    destination: String(base.destination || ''),
    departureTime: String(base.departureTime || base.createdAt || row.created_at || new Date().toISOString()),
    price: Number(base.price || 0),
    seatsAvailable: Number(base.seatsAvailable || 0),
    status: (row.status || base.status || 'available') as Ride['status'],
    createdAt: String(row.created_at || base.createdAt || new Date().toISOString()),
    driverPhotoUrl: base.driverPhotoUrl,
    driverRating: base.driverRating,
    fleetPartnerId: base.fleetPartnerId,
    fleetPartnerName: base.fleetPartnerName,
    originLocation: base.originLocation,
    destinationLocation: base.destinationLocation,
    departureDay: base.departureDay,
    departureDayLabel: base.departureDayLabel,
    departureClock: base.departureClock,
    departureNote: base.departureNote,
  };
};

const normalizeUserRow = (row: any): UserProfile => {
  const base = row.data && typeof row.data === 'object' ? row.data : {};
  return {
    ...base,
    uid: String(row.id || base.uid || ''),
    email: String(row.email || base.email || ''),
    displayName: String(row.display_name || base.displayName || ''),
    role: (row.role || base.role || 'consumer') as UserProfile['role'],
    status: (row.status || base.status || 'active') as UserProfile['status'],
    phoneNumber: row.phone_number || base.phoneNumber || '',
    photoURL: row.photo_url || base.photoURL || '',
    onboardingComplete:
      typeof row.onboarding_complete === 'boolean'
        ? row.onboarding_complete
        : Boolean(base.onboardingComplete),
    adminRole: row.admin_role || base.adminRole,
    verificationStatus: row.verification_status || base.verificationStatus,
    rejectionReason: row.rejection_reason || base.rejectionReason,
    verifiedBy: row.verified_by || base.verifiedBy,
    forcePasswordChange:
      typeof row.force_password_change === 'boolean'
        ? row.force_password_change
        : Boolean(base.forcePasswordChange),
    wallet: row.wallet || base.wallet,
    cashWallet: base.cashWallet,
    location: row.location || base.location,
    driverDetails: row.driver_details || base.driverDetails,
    createdAt: row.created_at || base.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || base.updatedAt || row.created_at || new Date().toISOString(),
  };
};

const normalizeBookingRow = (row: any): Booking => {
  const base = row.data && typeof row.data === 'object' ? row.data : {};
  return {
    ...base,
    id: String(row.id || base.id || ''),
    rideId: String(row.ride_id || base.rideId || ''),
    ride_id: row.ride_id || base.ride_id,
    consumerId: String(row.consumer_id || base.consumerId || ''),
    consumerName: String(base.consumerName || ''),
    consumerPhone: base.consumerPhone,
    driverId: String(row.driver_id || base.driverId || ''),
    driverName: String(base.driverName || ''),
    driverPhotoUrl: base.driverPhotoUrl,
    driverPhone: base.driverPhone,
    origin: String(base.origin || ''),
    destination: String(base.destination || ''),
    fare: Number(base.fare || 0),
    seatsBooked: Number(base.seatsBooked || 0),
    totalPrice: Number(base.totalPrice || 0),
    serviceFee: Number(base.serviceFee || 0),
    gstAmount: Number(base.gstAmount || 0),
    maiCoinsUsed: Number(base.maiCoinsUsed || 0),
    status: (row.status || base.status || 'pending') as Booking['status'],
    createdAt: String(row.created_at || base.createdAt || new Date().toISOString()),
  };
};

const annotateRidesWithFleetMetadata = (rides: Ride[], partners: B2BPartner[]) => {
  const driverFleetMap = new Map<string, { partnerId: string; partnerName: string }>();
  partners
    .filter((partner) => partner.type === 'fleet_owner' && partner.status === 'approved')
    .forEach((partner) => {
      (partner.data?.fleetVehicles || []).forEach((vehicle) => {
        if (vehicle.assignedDriverId) {
          driverFleetMap.set(vehicle.assignedDriverId, {
            partnerId: partner.id,
            partnerName: partner.businessName,
          });
        }
      });
    });

  return rides.map((ride) => {
    const fleetMeta = driverFleetMap.get(ride.driverId);
    if (!fleetMeta) return ride;
    return {
      ...ride,
      fleetPartnerId: fleetMeta.partnerId,
      fleetPartnerName: fleetMeta.partnerName,
    };
  });
};

const matchesRouteQuery = (ride: Ride, originQuery?: string, destinationQuery?: string) => {
  const originTokens = tokenizeText(originQuery || '');
  const destinationTokens = tokenizeText(destinationQuery || '');
  if (!originTokens.length && !destinationTokens.length) return true;

  const rideOrigin = normalizeText(ride.origin);
  const rideDestination = normalizeText(ride.destination);
  const rideRoute = `${rideOrigin} ${rideDestination}`;

  const originMatch = !originTokens.length || originTokens.every((token) => rideOrigin.includes(token) || rideRoute.includes(token));
  const destinationMatch =
    !destinationTokens.length || destinationTokens.every((token) => rideDestination.includes(token) || rideRoute.includes(token));

  return originMatch && destinationMatch;
};

async function expectSingle<T>(query: PromiseLike<{ data: T | null; error: any }>, fallbackMessage: string) {
  const { data, error } = await query;
  if (error) throw new Error(error.message || fallbackMessage);
  return data;
}

export const b2bPartnerService = {
  async getPartnerByAuthUser(authUserId: string) {
    const primaryMatch = await expectSingle(
      supabase
        .from('b2b_partners')
        .select('*')
        .eq('auth_user_id', authUserId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      'Failed to load partner profile.'
    );
    if (primaryMatch) {
      return normalizePartnerRow(primaryMatch);
    }

    const session = (await supabase.auth.getSession()).data.session;
    const sessionEmail = String(session?.user?.email || '').trim().toLowerCase();
    if (!sessionEmail) return null;

    const fallbackMatch = await expectSingle(
      supabase
        .from('b2b_partners')
        .select('*')
        .ilike('email', sessionEmail)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      'Failed to load partner profile.'
    );

    if (!fallbackMatch) return null;
    if (!fallbackMatch.auth_user_id) {
      const { data: reboundPartner, error: reboundError } = await supabase
        .from('b2b_partners')
        .update({ auth_user_id: authUserId })
        .eq('id', fallbackMatch.id)
        .select('*')
        .single();
      if (reboundError) throw new Error(reboundError.message || 'Failed to bind partner account.');
      return normalizePartnerRow(reboundPartner);
    }

    return normalizePartnerRow(fallbackMatch);
  },

  async createPartnerApplication(input: PartnerApplicationInput) {
    const { data, error } = await supabase
      .from('b2b_partners')
      .insert({
        auth_user_id: input.authUserId || null,
        business_name: input.businessName,
        type: input.type,
        gst_number: input.gstNumber || null,
        contact_person: input.contactPerson,
        phone: input.phone,
        email: input.email,
        document_url: input.documentUrl,
        signup_latitude: input.signupLatitude ?? null,
        signup_longitude: input.signupLongitude ?? null,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message || 'Failed to submit partner application.');
    return normalizePartnerRow(data);
  },

  async updatePartnerProfile(partnerId: string, patch: Partial<B2BPartner>) {
    const row: Record<string, any> = {};
    if (patch.businessName !== undefined) row.business_name = patch.businessName;
    if (patch.gstNumber !== undefined) row.gst_number = patch.gstNumber;
    if (patch.contactPerson !== undefined) row.contact_person = patch.contactPerson;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.email !== undefined) row.email = patch.email;
    if (patch.documentUrl !== undefined) row.document_url = patch.documentUrl;
    if (patch.commissionPercentage !== undefined) row.commission_percentage = patch.commissionPercentage;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.verifiedAt !== undefined) row.verified_at = patch.verifiedAt;
    if (patch.data !== undefined) row.data = patch.data;

    const { data, error } = await supabase
      .from('b2b_partners')
      .update(row)
      .eq('id', partnerId)
      .select('*')
      .single();
    if (error) throw new Error(error.message || 'Failed to update partner profile.');
    return normalizePartnerRow(data);
  },

  async listPendingPartners() {
    const { data, error } = await supabase
      .from('b2b_partners')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message || 'Failed to load pending partners.');
    return (data || []).map(normalizePartnerRow);
  },

  async listAllPartners() {
    const { data, error } = await supabase
      .from('b2b_partners')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message || 'Failed to load partner list.');
    return (data || []).map(normalizePartnerRow);
  },

  async setPartnerStatus(partnerId: string, status: ApprovalStatus) {
    const { data, error } = await supabase
      .from('b2b_partners')
      .update({
        status,
        verified_at: status === 'approved' ? new Date().toISOString() : null,
      })
      .eq('id', partnerId)
      .select('*')
      .single();
    if (error) throw new Error(error.message || 'Failed to update partner status.');
    return normalizePartnerRow(data);
  },

  async listPartnerBookings(partnerId: string) {
    const { data, error } = await supabase
      .from('partner_bookings')
      .select('*')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message || 'Failed to load partner ledger.');
    return (data || []).map(normalizePartnerBookingRow);
  },

  async createPartnerBooking(input: PartnerBookingInput) {
    const { data, error } = await supabase
      .from('partner_bookings')
      .insert({
        partner_id: input.partnerId,
        ride_id: input.rideId || null,
        total_fare: input.totalFare,
        partner_cut: input.partnerCut,
        driver_cut: input.driverCut,
        settlement_status: input.settlementStatus || 'pending',
        data: input.data || {},
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message || 'Failed to create partner booking.');
    return normalizePartnerBookingRow(data);
  },

  async createHotelDeskBooking(input: HotelDeskBookingInput) {
    const session = (await supabase.auth.getSession()).data.session;
    const accessToken = String(session?.access_token || '');
    if (!accessToken) {
      throw new Error('Partner session unavailable. Please sign in again.');
    }

    const response = await fetch('/api/admin-api?action=partner-create-booking', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.booking) {
      throw new Error(String(payload?.error || 'Failed to create secure partner booking.'));
    }
    return normalizePartnerBookingRow(payload.booking);
  },

  async listDispatchableRides(filters?: { originQuery?: string; destinationQuery?: string }) {
    const [{ data, error }, partners] = await Promise.all([
      supabase
        .from('rides')
        .select('*')
        .in('status', ['available'])
        .order('created_at', { ascending: false })
        .limit(80),
      this.listAllPartners(),
    ]);
    if (error) throw new Error(error.message || 'Failed to load rides for partner dispatch.');
    const annotatedRides = annotateRidesWithFleetMetadata((data || []).map(normalizeRideRow), partners);
    return annotatedRides.filter((ride) => matchesRouteQuery(ride, filters?.originQuery, filters?.destinationQuery));
  },

  async listUsersByIds(userIds: string[]) {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (!uniqueUserIds.length) return [] as UserProfile[];
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .in('id', uniqueUserIds);
    if (error) throw new Error(error.message || 'Failed to load fleet drivers.');
    return (data || []).map(normalizeUserRow);
  },

  async listRidesByDriverIds(driverIds: string[]) {
    const uniqueDriverIds = Array.from(new Set(driverIds.filter(Boolean)));
    if (!uniqueDriverIds.length) return [] as Ride[];
    const [{ data, error }, partners] = await Promise.all([
      supabase
        .from('rides')
        .select('*')
        .in('driver_id', uniqueDriverIds)
        .order('created_at', { ascending: false })
        .limit(120),
      this.listAllPartners(),
    ]);
    if (error) throw new Error(error.message || 'Failed to load fleet rides.');
    return annotateRidesWithFleetMetadata((data || []).map(normalizeRideRow), partners);
  },

  async listBookingsByDriverIds(driverIds: string[]) {
    const uniqueDriverIds = Array.from(new Set(driverIds.filter(Boolean)));
    if (!uniqueDriverIds.length) return [] as Booking[];
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .in('driver_id', uniqueDriverIds)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message || 'Failed to load fleet booking performance.');
    return (data || []).map(normalizeBookingRow);
  },

  async listFleetMappedPartners() {
    return this.listAllPartners().then((partners) => partners.filter((partner) => partner.type === 'fleet_owner'));
  },
  
  async listFleetMappedRidesAndBookings(driverIds: string[]) {
    const [drivers, rides, bookings] = await Promise.all([
      this.listUsersByIds(driverIds),
      this.listRidesByDriverIds(driverIds),
      this.listBookingsByDriverIds(driverIds),
    ]);
    return { drivers, rides, bookings };
  },

  async listHotelRouteMatches(originQuery: string, destinationQuery: string) {
    return this.listDispatchableRides({ originQuery, destinationQuery });
  },
};
