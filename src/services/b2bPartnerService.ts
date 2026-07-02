import { supabase } from '../lib/supabase';
import type { B2BPartner, PartnerBooking, PartnerType, ApprovalStatus, Ride } from '../types';

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
    originLocation: base.originLocation,
    destinationLocation: base.destinationLocation,
    departureDay: base.departureDay,
    departureDayLabel: base.departureDayLabel,
    departureClock: base.departureClock,
    departureNote: base.departureNote,
  };
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

  async listDispatchableRides() {
    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .in('status', ['available', 'negotiating', 'started', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message || 'Failed to load rides for partner dispatch.');
    return (data || []).map(normalizeRideRow);
  },
};
