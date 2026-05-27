import React, { useState, useEffect, useRef } from "react";
import { Menu, User, ChevronLeft, ChevronRight, X, Calendar as CalendarIcon, Phone, Mail, Leaf, MessageCircle, Send, LogOut, Sun, Moon, Plus, Trash2, Eye, Check, Lock, Unlock } from "lucide-react";
import { format, addDays, startOfToday, parseISO, isSameDay, setHours, setMinutes, isBefore, isAfter } from "date-fns";
import { es } from "date-fns/locale";
import { toast, Toaster } from "sonner";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import { cn } from "../lib/utils";

export class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return <div className="fixed inset-0 bg-spa-base flex items-center justify-center text-spa-crema p-8">
        <div className="text-center">
          <h2 className="text-xl font-serif mb-4">Algo salió mal</h2>
          <p className="text-sm text-[#7A7D7B] mb-4">Recarga la página o contacta al administrador</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-spa-gold text-spa-base rounded-xl text-sm font-bold">Recargar</button>
        </div>
      </div>;
    }
    return this.props.children;
  }
}

const intensityOptions = [
  { value: "baja", label: "Baja", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  { value: "media", label: "Media", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  { value: "alta", label: "Alta", className: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
];

const getIntensityInfo = (intensity?: string) =>
  intensityOptions.find(o => o.value === intensity) || { value: "", label: "—", className: "bg-white/5 text-[#7A7D7B] border-white/10" };

const getStatusInfo = (status?: string) => {
  switch (status) {
    case "attending": return { label: "Asistirá", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
    case "rescheduled": return { label: "Reagendada", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    case "pending": return { label: "Pendiente", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    case "cancelled": return { label: "Cancelada", className: "bg-rose-500/15 text-rose-400 border-rose-500/30" };
    default: return { label: "Confirmada", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
  }
};

interface SlotInfo {
  time: Date;
  isAvailable: boolean;
  isPast: boolean;
  appointment?: Appointment;
}

interface Appointment {
  id?: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  startTime: string;
  endTime?: string;
  status?: string;
  massageType?: string;
  price?: string;
  duration?: string;
  intensity?: string;
  locationId?: string;
}

interface Location {
  id: string;
  name: string;
  address: string;
  morningHours: string[];
  afternoonHours: string[];
  blockedDays: string[];
  blockedShifts: { date: string; shift: "morning" | "afternoon" }[];
}

interface AppConfig {
  bannerUrl: string;
  morningHours: string[];
  afternoonHours: string[];
  address: string;
  logoUrl: string;
  logoPosition: { x: number; y: number };
  massageTypes: { id: string; name: string; price: string; duration: string; description: string; intensity?: string }[];
  tagline?: string;
  blockedDays: string[];
  blockedShifts: { date: string; shift: "morning" | "afternoon" }[];
  phone?: string;
}

export default function App() {
  const [isAdminAuth, setIsAdminAuth] = useState(false);
  const [hasCreds, setHasCreds] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [selectedAdminLocation, setSelectedAdminLocation] = useState<Location | null>(null);
  const [newLocation, setNewLocation] = useState({ name: "", address: "" });
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [config, setConfig] = useState<AppConfig>({
    bannerUrl: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80",
    morningHours: [],
    afternoonHours: [],
    massageTypes: [],
    address: "",
    logoUrl: "",
    logoPosition: { x: 50, y: 50 },
    tagline: "",
    blockedDays: [],
    blockedShifts: []
  });
  
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [bookingSlot, setBookingSlot] = useState<Date | null>(null);
  const [showMassageError, setShowMassageError] = useState(false);
  const [viewingAppt, setViewingAppt] = useState<Appointment | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showSideMenu, setShowSideMenu] = useState(false);
  const [showServices, setShowServices] = useState(false);
  const [activeShift, setActiveShift] = useState<"morning" | "afternoon">("morning");
  const [formData, setFormData] = useState({ clientName: "", clientEmail: "", clientPhone: "", massageType: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [adminRescheduleSlot, setAdminRescheduleSlot] = useState<Date | null>(null);
  const [rescheduleApptId, setRescheduleApptId] = useState<string | null>(null);
  const [newMorningHour, setNewMorningHour] = useState("");
  const [newAfternoonHour, setNewAfternoonHour] = useState("");
  const [newMassage, setNewMassage] = useState({
    name: "",
    price: "",
    duration: "",
    description: "",
    intensity: "",
  });
  const [infoModalMassage, setInfoModalMassage] = useState<{ name: string; description: string } | null>(null);
  const [editMassageId, setEditMassageId] = useState<string | null>(null);
  const [showServiciosEditModal, setShowServiciosEditModal] = useState(false);
  const [showClientsPage, setShowClientsPage] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(startOfToday());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAppointment, setEmailAppointment] = useState<Appointment | null>(null);
  const [emailTemplate, setEmailTemplate] = useState("reminder");
  const [emailCustomText, setEmailCustomText] = useState("");
  const [showEmailCustomInput, setShowEmailCustomInput] = useState(false);
  const [historyFilterStatus, setHistoryFilterStatus] = useState<string>("all");
  const [historySearchQuery, setHistorySearchQuery] = useState<string>("");
  
  // Confirmation Modal State
  const [cancelModalData, setCancelModalData] = useState<{
    appt: Appointment;
    mode: "admin_delete" | "admin_cancel" | "client_cancel";
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [isCancellingAppt, setIsCancellingAppt] = useState(false);

  // Parallax Effect
  const heroRef = useRef(null);
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 500], [0, 200]);

  // Bot State
  const [showBot, setShowBot] = useState(false);
  const [botStep, setBotStep] = useState<"greeting"|"ask_email"|"ask_verification"|"show_appointments"|"reschedule"|"massages"|"info"|"faq"|"contact">("greeting");
  const [botData, setBotData] = useState({ email: "", verification: "", appts: [] as Appointment[], selectedApptId: "" });
  const [botRescheduleSlot, setBotRescheduleSlot] = useState<Date|null>(null);

  useEffect(() => {
    let cancelled = false;

    const now = new Date();
    if (now.getHours() >= 14) setActiveShift("afternoon");
    
    // Check server-side session (single source of truth for admin auth)
    fetch("/api/auth/session")
      .then(r => r.json())
      .then(session => {
        if (cancelled) return;
        if (session.authenticated) {
          setIsAdminAuth(true);
          if (window.location.search.includes("admin=true")) {
            window.history.replaceState({}, document.title, "/");
            toast.success("Modo Administrador Activo");
          }
        }
      })
      .catch(() => {});

    fetch("/api/config")
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setHasCreds(d.hasCredentials);

        // Handle Manage Token
        const params = new URLSearchParams(window.location.search);
        const manageId = params.get("manage");
        if (manageId) {
            // Find the appointment and show bot management
            fetchAppointments().then(appts => {
                if (cancelled) return;
                const appt = (appts as any[]).find(a => a.id === manageId);
                if (appt) {
                    setBotData(prev => ({...prev, email: appt.clientEmail, appts: [appt]}));
                    setBotStep("show_appointments");
                    setShowBot(true);
                    window.history.replaceState({}, document.title, "/");
                }
            }).catch(() => {
              if (!cancelled) toast.error("Error al consultar la cita");
            });
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Error al cargar configuración");
      });
      
    fetchConfig();
    fetchAppointments();
    fetchLocations();

    return () => { cancelled = true; };
  }, []);

  const fetchLocations = async () => {
    try {
      const res = await fetch("/api/locations");
      const data = await res.json();
      if (Array.isArray(data)) {
        setLocations(data);
        if (data.length > 0) {
          setSelectedLocation(data[0]);
          setSelectedAdminLocation(data[0]);
        }
      }
    } catch (err) {
      toast.error("Error al cargar ubicaciones");
    }
  };

  const fetchConfig = async () => {
    try {
      const r = await fetch("/api/app-config");
      const d = await r.json();
      if (d && !d.error && Array.isArray(d.morningHours)) {
        setConfig(d);
        const now = new Date();
        const afternoonThreshold = d.afternoonHours?.length > 0
          ? parseInt(d.afternoonHours[0].split(":")[0])
          : 14;
        if (now.getHours() >= afternoonThreshold) setActiveShift("afternoon");
      } else if (d && d.error) {
        toast.error(`Error de configuración: ${d.error}`);
      }
    } catch {
      toast.error("Error al cargar configuración");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAppointments = async () => {
    try {
      const res = await fetch("/api/appointments");
      const data = await res.json();
      setAppointments(data);
      return data;
    } catch {
      toast.error("Error al cargar citas");
      return [];
    }
  };

  const handleUpdateConfig = async (newConfig: AppConfig) => {
    try {
      await fetch("/api/app-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConfig)
      });
      setConfig(newConfig);
      toast.success("Configuración actualizada");
    } catch (e) {
      toast.error("Error al actualizar");
    }
  };

  const handleAddHour = async (shift: "morning" | "afternoon") => {
    const value = shift === "morning" ? newMorningHour : newAfternoonHour;
    if (!value) return;

    if (selectedAdminLocation) {
      const current = shift === "morning" ? selectedAdminLocation.morningHours : selectedAdminLocation.afternoonHours;
      if (current.includes(value)) {
        toast.error("Ese horario ya existe");
        return;
      }
      const updated = [...current, value].sort();
      await handleUpdateLocationConfig(selectedAdminLocation.id, {
        [shift === "morning" ? "morningHours" : "afternoonHours"]: updated
      });
      if (shift === "morning") setNewMorningHour("");
      else setNewAfternoonHour("");
      return;
    }

    const current =
      shift === "morning" ? config.morningHours : config.afternoonHours;

    if (current.includes(value)) {
      toast.error("Ese horario ya existe");
      return;
    }

    const updated = [...current, value].sort();

    await handleUpdateConfig(
      shift === "morning"
        ? { ...config, morningHours: updated }
        : { ...config, afternoonHours: updated }
    );

    if (shift === "morning") setNewMorningHour("");
    else setNewAfternoonHour("");
  };

  const handleAddMassageType = async () => {
    if (!newMassage.name.trim()) {
      toast.error("Introduce el nombre del masaje");
      return;
    }

    let updatedTypes;
    if (editMassageId) {
      updatedTypes = config.massageTypes.map((m) =>
        m.id === editMassageId
          ? { ...m, name: newMassage.name.trim(), price: newMassage.price.trim(), duration: newMassage.duration.trim(), description: newMassage.description.trim(), intensity: newMassage.intensity }
          : m
      );
    } else {
      updatedTypes = [
        ...config.massageTypes,
        {
          id: Date.now().toString(),
          name: newMassage.name.trim(),
          price: newMassage.price.trim(),
          duration: newMassage.duration.trim(),
          description: newMassage.description.trim(),
          intensity: newMassage.intensity,
        },
      ];
    }

    await handleUpdateConfig({ ...config, massageTypes: updatedTypes });
    setEditMassageId(null);
    setNewMassage({ name: "", price: "", duration: "", description: "", intensity: "" });
  };

  const handleBotVerify = async (val: string) => {
    if (!val) return;
    try {
      const res = await fetch("/api/bot/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: botData.email, verification: val })
      });
      if (res.ok) {
          const data = await res.json();
          setBotData({...botData, verification: val, appts: data});
          setBotStep("show_appointments");
      } else {
          toast.error("No se encontraron citas. Verifica tus datos.");
      }
    } catch {
      toast.error("Error de conexión al verificar");
    }
  };

  const handleAdminDelete = (appt: Appointment) => {
    setCancelModalData({ appt, mode: "admin_delete" });
  };

  const handleLogout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    setIsAdminAuth(false);
    setShowAdminPanel(false);
    toast.success("Sesión cerrada");
  };

  const getAvailableSlots = (shift: "morning" | "afternoon", customDate?: Date) => {
    const targetDate = customDate || selectedDate;
    
    const activeLoc = selectedLocation;
    const hours = activeLoc 
      ? (shift === "morning" ? activeLoc.morningHours : activeLoc.afternoonHours) 
      : (shift === "morning" ? config.morningHours : config.afternoonHours);
    
    const blockedDays = activeLoc ? activeLoc.blockedDays : config.blockedDays;
    const blockedShifts = activeLoc ? activeLoc.blockedShifts : config.blockedShifts;
    
    const now = new Date();
    const dateStr = format(targetDate, "yyyy-MM-dd");
    if ((blockedDays || []).includes(dateStr)) return [];
    if ((blockedShifts || []).some(b => b.date === dateStr && b.shift === shift)) return [];
    
    return (hours || []).map(h => {
      const [hh, mm] = h.split(":").map(Number);
      const slotTime = setMinutes(setHours(targetDate, hh), mm);
      const existing = appointments.find(a => 
        (activeLoc ? a.locationId === activeLoc.id : true) &&
        isSameDay(parseISO(a.startTime), slotTime) && 
        parseISO(a.startTime).getHours() === hh && 
        parseISO(a.startTime).getMinutes() === mm &&
        a.status !== 'cancelled'
      );
      const isPast = isBefore(slotTime, now);
      
      return {
        time: slotTime,
        isAvailable: !existing && !isPast,
        isPast,
        appointment: existing
      };
    }).sort((a,b) => a.time.getTime() - b.time.getTime());
  };

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingSlot) return;
    
    if (!formData.massageType) {
      setShowMassageError(true);
      setTimeout(() => setShowMassageError(false), 3000);
      return;
    }
    
    setIsSubmitting(true);
    try {
      const selectedMassage = config.massageTypes.find(m => m.name === formData.massageType);
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          startTime: bookingSlot.toISOString(),
          endTime: new Date(bookingSlot.getTime() + 60*60*1000).toISOString(),
          price: selectedMassage?.price || "",
          duration: selectedMassage?.duration || "",
          locationId: selectedLocation?.id || null
        })
      });
      if (!res.ok) throw new Error();
      toast.success("¡Cita reservada con éxito!");
      setBookingSlot(null);
      setFormData({ clientName: "", clientEmail: "", clientPhone: "", massageType: "" });
      fetchAppointments();
    } catch(err) {
      toast.error("Error al reservar");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAdminCancel = (appt: Appointment) => {
    setCancelReason("");
    setCancelModalData({ appt, mode: "admin_cancel" });
  };

  const executeCancelAction = async () => {
    if (!cancelModalData) return;
    const { appt, mode } = cancelModalData;
    setIsCancellingAppt(true);

    try {
      if (mode === "admin_delete") {
        await fetch(`/api/appointments/${appt.id}`, { method: "DELETE" });
        toast.success("Cita eliminada");
        fetchAppointments();
        setCancelModalData(null);
      } else if (mode === "admin_cancel") {
        await fetch(`/api/appointments/${appt.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: cancelReason || undefined })
        });
        toast.success("Cita cancelada");
        setViewingAppt(null);
        fetchAppointments();
        setCancelModalData(null);
      } else if (mode === "client_cancel") {
        const res = await fetch(`/api/bot/appointments/${appt.id}/cancel`, { 
            method: "POST", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: botData.email }) 
        });
        const data = await res.json();
        if (data.error) {
            toast.error(data.error);
        } else {
            toast.success("Cita cancelada con éxito");
            fetchAppointments();
            setBotStep("greeting");
            setShowBot(false);
            setCancelModalData(null);
        }
      }
    } catch {
      toast.error("Error al procesar la cancelación");
    } finally {
      setIsCancellingAppt(false);
    }
  };

  const handleUpdateLocationConfig = async (locId: string, updates: Partial<Location>) => {
    try {
      const res = await fetch(`/api/locations/${locId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const updatedLocs = locations.map(l => l.id === locId ? { ...l, ...updates } : l);
        setLocations(updatedLocs);
        const updatedActive = updatedLocs.find(l => l.id === selectedLocation?.id) || null;
        const updatedAdmin = updatedLocs.find(l => l.id === selectedAdminLocation?.id) || null;
        if (updatedActive) setSelectedLocation(updatedActive);
        if (updatedAdmin) setSelectedAdminLocation(updatedAdmin);
        toast.success("Ubicación actualizada correctamente");
      } else {
        toast.error("Error al actualizar la ubicación");
      }
    } catch {
      toast.error("Error al actualizar la ubicación");
    }
  };

  const toggleDayBlock = async (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    if (selectedAdminLocation) {
      const current = selectedAdminLocation.blockedDays || [];
      const newBlockedDays = current.includes(dateStr) ? current.filter(d => d !== dateStr) : [...current, dateStr];
      await handleUpdateLocationConfig(selectedAdminLocation.id, { blockedDays: newBlockedDays });
      return;
    }

    const current = config.blockedDays || [];
    const newBlockedDays = current.includes(dateStr) ? current.filter(d => d !== dateStr) : [...current, dateStr];
    try {
      const res = await fetch("/api/app-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockedDays: newBlockedDays })
      });
      if (res.ok) {
        const d = await res.json();
        if (d && !d.error && Array.isArray(d.morningHours)) setConfig(d);
      }
    } catch {
      toast.error("Error al bloquear día");
    }
  };

  const toggleShiftBlock = async (date: Date, shift: "morning" | "afternoon") => {
    const dateStr = format(date, "yyyy-MM-dd");
    if (selectedAdminLocation) {
      const current = selectedAdminLocation.blockedShifts || [];
      const idx = current.findIndex(b => b.date === dateStr && b.shift === shift);
      const newBlockedShifts = idx >= 0 ? current.filter((_, i) => i !== idx) : [...current, { date: dateStr, shift }];
      await handleUpdateLocationConfig(selectedAdminLocation.id, { blockedShifts: newBlockedShifts });
      return;
    }

    const current = config.blockedShifts || [];
    const idx = current.findIndex(b => b.date === dateStr && b.shift === shift);
    const newBlockedShifts = idx >= 0 ? current.filter((_, i) => i !== idx) : [...current, { date: dateStr, shift }];
    try {
      const res = await fetch("/api/app-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockedShifts: newBlockedShifts })
      });
      if (res.ok) {
        const d = await res.json();
        if (d && !d.error && Array.isArray(d.morningHours)) setConfig(d);
      }
    } catch {
      toast.error("Error al bloquear turno");
    }
  };

  const isDayBlocked = (date: Date) => {
    if (selectedAdminLocation) {
      return (selectedAdminLocation.blockedDays || []).includes(format(date, "yyyy-MM-dd"));
    }
    return (config.blockedDays || []).includes(format(date, "yyyy-MM-dd"));
  };

  const isShiftBlocked = (date: Date, shift: "morning" | "afternoon") => {
    if (selectedAdminLocation) {
      return (selectedAdminLocation.blockedShifts || []).some(b => b.date === format(date, "yyyy-MM-dd") && b.shift === shift);
    }
    return (config.blockedShifts || []).some(b => b.date === format(date, "yyyy-MM-dd") && b.shift === shift);
  };

  const handleResendEmail = async (appt: Appointment) => {
    try {
      const res = await fetch(`/api/appointments/${appt.id}/resend-email`, { method: "POST" });
      if (res.ok) {
        toast.success("Correo reenviado correctamente");
      } else {
        const err = await res.json();
        toast.error(err.error || "Error al reenviar correo");
      }
    } catch {
      toast.error("Error de conexión al reenviar correo");
    }
  };

  const handleSendCustomEmail = async () => {
    if (!emailAppointment) return;
    try {
      const res = await fetch(`/api/appointments/${emailAppointment.id}/send-custom-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: emailTemplate, customText: emailCustomText })
      });
      if (res.ok) {
        toast.success("Correo enviado correctamente");
        setShowEmailModal(false);
        setEmailAppointment(null);
        setEmailTemplate("reminder");
        setEmailCustomText("");
        setShowEmailCustomInput(false);
      } else {
        const err = await res.json();
        toast.error(err.error || "Error al enviar correo");
      }
    } catch {
      toast.error("Error de conexión");
    }
  };

  const handleAddToCalendar = async (appt: Appointment) => {
    try {
      const res = await fetch(`/api/appointments/${appt.id}/add-to-calendar`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Añadido al calendario correctamente");
      } else {
        toast.error(data.error || "Error al añadir al calendario");
      }
    } catch {
      toast.error("Error de conexión al añadir al calendario");
    }
  };

  const handleAdminReschedule = async (newSlot: Date) => {
    if (!rescheduleApptId) return;
    try {
      await fetch(`/api/appointments/${rescheduleApptId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: newSlot.toISOString(),
          endTime: new Date(newSlot.getTime() + 60*60*1000).toISOString()
        })
      });
      toast.success("Cita reprogramada");
      setViewingAppt(null);
      setAdminRescheduleSlot(null);
      setRescheduleApptId(null);
      fetchAppointments();
    } catch {
      toast.error("Error al reprogramar cita");
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05, delayChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10, scale: 0.95 },
    show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 300, damping: 25 } }
  } as const;

  const renderSlot = (slot: SlotInfo) => {
    const isReserved = !slot.isAvailable && !slot.isPast;
    return (
      <motion.button
        key={slot.time.toISOString()}
        variants={itemVariants}
        whileHover={slot.isAvailable ? { scale: 1.02, y: -2 } : {}}
        whileTap={slot.isAvailable ? { scale: 0.98 } : {}}
        onClick={() => {
          if (adminRescheduleSlot && slot.isAvailable) {
            handleAdminReschedule(slot.time);
          } else if (botStep === "reschedule" && slot.isAvailable) setBotRescheduleSlot(slot.time);
          else if (isAdminAuth && slot.appointment) setViewingAppt(slot.appointment);
          else if (slot.isAvailable) setBookingSlot(slot.time);
        }}
        disabled={(!slot.isAvailable && !isAdminAuth) || slot.isPast}
        className={cn(
          "relative flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-300 border overflow-hidden",
          slot.isAvailable ? "bg-spa-elevated border-spa-accent/20 hover:border-spa-gold hover:shadow-[0_0_15px_rgba(201,169,110,0.1)] text-spa-crema cursor-pointer" : "cursor-not-allowed",
          isReserved && "bg-spa-card border-transparent diagonal-stripes",
          slot.isPast && "opacity-20 grayscale border-transparent"
        )}
      >
        <div className="flex flex-col items-center z-10">
          <span className={cn("text-lg font-serif mb-0.5", (slot.isAvailable || (isAdminAuth && slot.appointment)) ? "text-spa-crema" : "text-[#7A7D7B]")}>
            {format(slot.time, "HH:mm")}
          </span>
          {isAdminAuth && slot.appointment ? (
            <span className="text-[8px] font-bold text-spa-gold uppercase tracking-[0.1em]">{slot.appointment.clientName.split(" ")[0]}</span>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-[8px] font-bold uppercase tracking-widest text-[#7A7D7B]">
                {slot.isPast ? "Pasado" : (slot.isAvailable ? "Libre" : "Ocupado")}
              </span>
            </div>
          )}
        </div>
        {slot.isAvailable && <div className="absolute inset-0 bg-gradient-to-br from-spa-gold/5 to-transparent pointer-events-none" />}
      </motion.button>
    );
  };

  const upcomingDays = Array.from({ length: 14 }).map((_, i) => addDays(startOfToday(), i));

  if (isLoading && !config.bannerUrl) {
    return (
      <div className="fixed inset-0 bg-spa-base flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-spa-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="fixed inset-0 bg-spa-base flex flex-col items-center sm:p-6 font-sans text-spa-crema overflow-hidden">
      <div className="noise-overlay" />
      <Toaster position="top-center" richColors theme="dark" />
      
      <div className="w-full max-w-4xl h-full sm:h-[850px] bg-spa-base sm:rounded-[40px] shadow-2xl flex flex-col relative border border-white/5 overflow-hidden transition-all duration-500">
        
        {/* Hero Section */}
        <div ref={heroRef} className="relative h-48 w-full shrink-0 overflow-hidden">
          <motion.img 
            style={{ y: heroY }}
            src={config.bannerUrl} 
            className="w-full h-full object-cover opacity-40 scale-105 object-[50%_30%]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-spa-base via-spa-base/20 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-spa-gold/10 via-spa-accent/5 to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(201,169,110,0.15),transparent_70%)]" />
          <div className="absolute top-0 left-0 right-0 p-8 flex justify-between items-start z-20">
            <div className="flex flex-col">
              <h1 className="text-3xl md:text-4xl font-serif text-spa-crema tracking-tight">JP Brow Studio</h1>
              <div className="h-0.5 w-10 bg-spa-gold mt-2 mb-1.5" />
              <p className="text-[8px] font-bold text-spa-gold uppercase tracking-[0.4em]">Brow Design Studio</p>
              {config.tagline && <p className="text-[9px] text-spa-gold/70 italic mt-1.5 tracking-wide">{config.tagline}</p>}
            </div>
            {config?.logoUrl && (
              <div className="w-14 h-14 md:w-16 md:h-16 rounded-full overflow-hidden border-2 border-spa-gold/30 shrink-0 bg-spa-elevated">
                <img
                  src={config.logoUrl}
                  alt="Logo"
                  className="w-full h-full object-cover"
                  style={{ objectPosition: `${(config.logoPosition || { x: 50, y: 50 }).x}% ${(config.logoPosition || { x: 50, y: 50 }).y}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Date Picker */}
        <div className="-mt-12 z-30 relative">
          <div className="flex gap-3 overflow-x-auto no-scrollbar py-8 px-6 sm:px-8">
            {upcomingDays.map((day) => {
              const active = isSameDay(day, selectedDate);
              const past = isBefore(day, startOfToday());
              const freeCount = [...getAvailableSlots("morning", day), ...getAvailableSlots("afternoon", day)].filter(s => s.isAvailable).length;
              
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDate(day)}
                  disabled={past}
                  className={cn(
                    "flex flex-col items-center justify-center min-w-[55px] h-[80px] rounded-[16px] transition-all duration-500 border group relative",
                    active ? "bg-gradient-to-b from-spa-accent to-[#6B5340] border-spa-gold text-spa-crema shadow-2xl scale-105" : "bg-spa-card border-white/5 text-[#7A7D7B] hover:border-white/20"
                  )}
                >
                  <span className="text-[7px] font-bold uppercase tracking-widest mb-1 opacity-60">{format(day, "eee", { locale: es })}</span>
                  <span className="text-xl font-serif font-medium">{format(day, "d")}</span>
                  {active && <motion.div layoutId="date-dot" className="w-0.5 h-0.5 bg-spa-gold rounded-full mt-1 shadow-[0_0_10px_#C9A96E]" />}
                  {freeCount > 0 && !active && (
                    <span className="absolute -top-1 -right-1 bg-spa-gold text-spa-base text-[7px] font-bold px-1 py-0.5 rounded-full">{freeCount}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-6 sm:px-8 pb-32">
          {/* Ubicaciones Selector (Píldora Animada) */}
          {locations.length > 1 && (
            <div className="flex p-1 bg-spa-card border border-white/5 rounded-[24px] mb-6 relative max-w-md mx-auto glow-gold">
              {locations.map((loc) => {
                const isSelected = selectedLocation?.id === loc.id;
                return (
                  <button
                    key={loc.id}
                    onClick={() => setSelectedLocation(loc)}
                    className={cn(
                      "flex-1 py-3 px-4 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest z-10 transition-all relative cursor-pointer whitespace-nowrap",
                      isSelected ? "text-spa-base font-extrabold" : "text-[#7A7D7B]"
                    )}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="activeLocationPill"
                        className="absolute inset-0 rounded-[20px] bg-spa-gold shadow-2xl z-0"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                    <span className="relative z-10">{loc.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Shift Selector */}
          <div className="flex p-1 bg-spa-card border border-white/5 rounded-[20px] mb-8 relative max-w-sm mx-auto glow-gold">
            <motion.div
              className="absolute inset-y-1 rounded-[16px] bg-spa-accent shadow-2xl z-0"
              initial={false}
              animate={{ x: activeShift === "morning" ? 0 : "100%", width: "calc(50% - 4px)" }}
              style={{ left: 4 }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
            />
            <button onClick={() => setActiveShift("morning")} className={cn("flex-1 py-3 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest z-10 transition-all", activeShift === "morning" ? "text-spa-crema" : "text-[#7A7D7B]")}>
              <Sun size={12} /> Mañana
            </button>
            <button onClick={() => setActiveShift("afternoon")} className={cn("flex-1 py-3 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest z-10 transition-all", activeShift === "afternoon" ? "text-spa-crema" : "text-[#7A7D7B]")}>
              <Moon size={12} /> Tarde
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
            <section className={cn("flex flex-col space-y-8", activeShift !== "morning" && "hidden md:flex")}>
              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent to-spa-accent/30" />
                <h2 className="text-[11px] font-bold text-spa-gold uppercase tracking-[0.35em]">Sesiones Mañana</h2>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent to-spa-accent/30" />
              </div>
              <motion.div 
                variants={containerVariants}
                initial="hidden"
                animate="show"
                key={`morning-${selectedDate.toISOString()}`}
                className="grid grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {getAvailableSlots("morning").map(renderSlot)}
              </motion.div>
            </section>

            <section className={cn("flex flex-col space-y-8", activeShift !== "afternoon" && "hidden md:flex")}>
              <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent to-spa-accent/30" />
                <h2 className="text-[11px] font-bold text-spa-gold uppercase tracking-[0.35em]">Sesiones Tarde</h2>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent to-spa-accent/30" />
              </div>
              <motion.div 
                variants={containerVariants}
                initial="hidden"
                animate="show"
                key={`afternoon-${selectedDate.toISOString()}`}
                className="grid grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {getAvailableSlots("afternoon").map(renderSlot)}
              </motion.div>
            </section>
          </div>
        </div>

        {/* Footer Bar - Pill Version */}
        <div className="absolute bottom-6 inset-x-8 h-16 bg-spa-card/80 backdrop-blur-2xl border border-white/10 rounded-full flex items-center justify-between px-4 z-40 shadow-2xl">
           <div className="flex-1 flex justify-start">
              <button 
                onClick={() => setShowSideMenu(true)} 
                className="w-10 h-10 bg-white/5 border border-white/10 rounded-full flex items-center justify-center text-spa-gold hover:bg-spa-gold hover:text-spa-base transition-all"
              >
                <Menu size={18} />
              </button>
           </div>
           <div className="flex flex-col items-center">
             <span className="text-sm font-serif text-spa-crema tracking-tight">JP Brows</span>
             <span className="text-[7px] text-spa-gold font-bold uppercase tracking-[0.2em] -mt-0.5">Diseño & Belleza de Cejas</span>
           </div>
           <div className="flex-1 flex justify-end">
              <button 
                onClick={()=>setShowBot(true)}
                className="relative w-10 h-10 bg-spa-gold rounded-full shadow-lg flex items-center justify-center text-spa-base hover:scale-105 active:scale-95 transition-all pulse-ring"
              >
                  <MessageCircle size={18} />
              </button>
           </div>
        </div>

        {/* Modals & Overlays */}
        <AnimatePresence>
          {bookingSlot && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[100] bg-spa-base/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
               <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} transition={{ type: "spring", damping: 30, stiffness: 300 }} className="w-full max-w-md bg-spa-card rounded-[24px] sm:rounded-[32px] border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                  <div className="p-6 sm:p-8 overflow-y-auto no-scrollbar flex-1 min-h-0">
                   <div className="flex justify-between items-center mb-5 sm:mb-6">
                       <h2 className="text-2xl sm:text-3xl font-serif">Reserva</h2>
                       <button onClick={() => setBookingSlot(null)} className="p-1.5 sm:p-2 bg-spa-elevated rounded-full hover:text-spa-gold transition-colors"><X size={18}/></button>
                   </div>
                   
<div className="bg-gradient-to-r from-spa-accent/20 to-transparent p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-spa-gold/20 mb-6 sm:mb-8 flex items-center gap-3 sm:gap-4">
                       <div className="w-10 h-10 sm:w-12 sm:h-12 bg-spa-gold rounded-lg sm:rounded-xl flex items-center justify-center text-spa-base shadow-xl shrink-0"><CalendarIcon size={18}/></div>
                       <div>
                         <p className="text-[8px] font-bold text-spa-gold uppercase tracking-[0.1em] mb-0.5">{format(bookingSlot, "EEEE d MMMM", { locale: es })}</p>
                         <p className="text-lg sm:text-xl font-serif">{format(bookingSlot, "HH:mm")} • 60 min</p>
                       </div>
                    </div>

                    {showMassageError && (
                      <div className="bg-rose-500/20 border border-rose-500/40 rounded-xl p-4 flex items-center gap-3 mb-4">
                        <span className="text-rose-500 text-sm font-bold">Tienes que seleccionar un tipo de masaje</span>
                      </div>
                    )}

                    <form onSubmit={handleBook} className="space-y-4 sm:space-y-5">
                      <div className="space-y-2">
                         <label className="text-[9px] font-bold text-spa-gold uppercase tracking-widest px-1">Selecciona Masaje</label>
                          <div className="grid grid-cols-1 gap-2">
                            {config.massageTypes.map(m => {
                              const isSelected = formData.massageType === m.name;
                              return (
                                <div key={m.id}>
                                  <button 
                                   type="button"
                                   onClick={() => setFormData({...formData, massageType: isSelected ? "" : m.name})}
                                   className={cn(
                                     "w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all",
                                     isSelected ? "bg-spa-accent/20 border-spa-gold rounded-b-none" : "bg-spa-elevated border-white/5"
                                   )}
                                  >
                                    <div>
                                      <p className="text-xs font-bold flex items-center gap-2"><Leaf size={12} className="text-spa-gold shrink-0" />{m.name}
                                        {m.intensity && (
                                          <span className={`px-1.5 py-0.5 rounded-md text-[6px] font-bold uppercase tracking-wider border ${getIntensityInfo(m.intensity).className}`}>
                                            {getIntensityInfo(m.intensity).label}
                                          </span>
                                        )}
                                      </p>
                                      <p className="text-[9px] opacity-60">{m.duration}</p>
                                    </div>
                                    <span className="text-xs font-bold text-spa-gold">{m.price}</span>
                                  </button>
                                  {isSelected && m.description && (
                                    <div className="bg-spa-accent/10 border border-t-0 border-spa-gold rounded-b-xl px-3 py-2.5 text-[10px] text-spa-crema/70 leading-relaxed">
                                      {m.description}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                      </div>
                      <div className="floating-label-group">
                        <input required className="w-full h-12 sm:h-14 bg-spa-elevated rounded-lg sm:rounded-xl px-4 sm:px-5 outline-none border border-white/5 focus:border-spa-gold transition-all text-sm" placeholder=" " value={formData.clientName} onChange={e => setFormData({...formData, clientName: e.target.value})}/>
                        <label className="absolute left-4 sm:left-5 top-3.5 sm:top-4 text-[#7A7D7B] pointer-events-none transition-all text-xs sm:text-sm">Nombre Completo</label>
                      </div>
                      <div className="floating-label-group">
                        <input required type="email" className="w-full h-12 sm:h-14 bg-spa-elevated rounded-lg sm:rounded-xl px-4 sm:px-5 outline-none border border-white/5 focus:border-spa-gold transition-all text-sm" placeholder=" " value={formData.clientEmail} onChange={e => setFormData({...formData, clientEmail: e.target.value})}/>
                        <label className="absolute left-4 sm:left-5 top-3.5 sm:top-4 text-[#7A7D7B] pointer-events-none transition-all text-xs sm:text-sm">Correo Electrónico</label>
                      </div>
                      <div className="floating-label-group">
                        <input type="tel" className="w-full h-12 sm:h-14 bg-spa-elevated rounded-lg sm:rounded-xl px-4 sm:px-5 outline-none border border-white/5 focus:border-spa-gold transition-all text-sm" placeholder=" " value={formData.clientPhone} onChange={e => setFormData({...formData, clientPhone: e.target.value})}/>
                        <label className="absolute left-4 sm:left-5 top-3.5 sm:top-4 text-[#7A7D7B] pointer-events-none transition-all text-xs sm:text-sm">Teléfono (Opcional)</label>
                      </div>
                      <button disabled={isSubmitting} className="w-full h-12 sm:h-14 bg-spa-gold text-spa-base font-bold uppercase tracking-[0.2em] rounded-lg sm:rounded-xl mt-2 hover:opacity-90 active:scale-95 transition-all shadow-xl text-xs sm:text-sm">
                        {isSubmitting ? "Procesando..." : "Confirmar Cita"}
                      </button>
                   </form>
                 </div>
               </motion.div>
             </motion.div>
           )}

           {/* Appointment Detail Modal (Admin) */}
           {viewingAppt && (
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[100] bg-spa-base/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
                <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} transition={{ type: "spring", damping: 30, stiffness: 300 }} className="w-full max-w-md bg-spa-card rounded-[24px] sm:rounded-[32px] border border-white/10 shadow-2xl overflow-hidden">
                  <div className="p-6 sm:p-8">
                    <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl sm:text-3xl font-serif">Detalle de Cita</h2>
                      <button onClick={() => setViewingAppt(null)} className="p-1.5 sm:p-2 bg-spa-elevated rounded-full hover:text-spa-gold transition-colors"><X size={18}/></button>
                    </div>
                    <div className="space-y-4">
                      <div className="bg-gradient-to-r from-spa-accent/20 to-transparent p-4 rounded-xl border border-spa-gold/20">
                        <p className="text-lg font-serif text-spa-crema">{viewingAppt.clientName}</p>
                        <p className="text-[10px] text-spa-gold font-medium mt-1">{viewingAppt.clientEmail} {viewingAppt.clientPhone ? `• ${viewingAppt.clientPhone}` : ''}</p>
                      </div>
                      <div className="bg-spa-elevated p-4 rounded-xl border border-white/5 space-y-2">
                        <div className="flex justify-between">
                          <span className="text-[9px] font-bold text-spa-gold uppercase tracking-widest">Fecha</span>
                          <span className="text-sm">{format(parseISO(viewingAppt.startTime), "EEEE d 'de' MMMM", { locale: es })}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[9px] font-bold text-spa-gold uppercase tracking-widest">Hora</span>
                          <span className="text-sm">{format(parseISO(viewingAppt.startTime), "HH:mm")}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-bold text-spa-gold uppercase tracking-widest">Servicio</span>
                          <span className="text-sm flex items-center gap-2">{viewingAppt.massageType || 'No especificado'}
                            {(() => {
                              const mt = config.massageTypes.find(t => t.name === viewingAppt.massageType);
                              if (mt?.intensity) {
                                const info = getIntensityInfo(mt.intensity);
                                return <span className={`px-2 py-0.5 rounded-md text-[7px] font-bold uppercase tracking-wider border ${info.className}`}>{info.label}</span>;
                              }
                              return null;
                            })()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[9px] font-bold text-spa-gold uppercase tracking-widest">Duración</span>
                          <span className="text-sm">{viewingAppt.duration || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[9px] font-bold text-spa-gold uppercase tracking-widest">Precio</span>
                          <span className="text-sm font-bold text-spa-gold">{viewingAppt.price || '—'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-bold text-spa-gold uppercase tracking-widest">Estado</span>
                          <span className={`px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider border ${getStatusInfo(viewingAppt.status).className}`}>{getStatusInfo(viewingAppt.status).label}</span>
                        </div>
                      </div>
                      {isBefore(parseISO(viewingAppt.startTime), new Date()) ? (
                        <div className="bg-spa-elevated p-4 rounded-xl border border-white/5 text-center">
                          <p className="text-[10px] text-[#7A7D7B] uppercase tracking-widest">Cita pasada — No disponible</p>
                        </div>
                      ) : (
                        <div className="flex gap-3 pt-2">
                          <button onClick={() => { setAdminRescheduleSlot(new Date()); setRescheduleApptId(viewingAppt!.id!); setViewingAppt(null); toast.info("Selecciona un horario disponible en el calendario"); }} className="flex-1 py-4 bg-spa-accent/10 border border-spa-accent/30 rounded-xl text-[9px] font-bold uppercase tracking-widest text-spa-gold hover:bg-spa-accent hover:text-spa-base transition-all">Reagendar</button>
                          <button onClick={() => { setEmailAppointment(viewingAppt); setShowEmailModal(true); }} className="flex-1 py-4 bg-blue-500/10 border border-blue-500/30 rounded-xl text-[9px] font-bold uppercase tracking-widest text-blue-400 hover:bg-blue-500 hover:text-white transition-all"><Mail size={14} className="inline mr-1" />Correo</button>
                          <button onClick={() => { handleAddToCalendar(viewingAppt); }} className="flex-1 py-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-[9px] font-bold uppercase tracking-widest text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all"><CalendarIcon size={14} className="inline mr-1" />Calendario</button>
                          <button onClick={() => handleAdminCancel(viewingAppt)} className="flex-1 py-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-[9px] font-bold uppercase tracking-widest text-rose-500 hover:bg-rose-500 hover:text-white transition-all">Cancelar</button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
             </motion.div>
           )}

           {/* Reschedule mode banner */}
           {adminRescheduleSlot && !viewingAppt && (
             <div className="absolute bottom-28 inset-x-8 z-50 bg-spa-accent/20 backdrop-blur-xl border border-spa-gold/30 rounded-2xl p-4 flex items-center justify-between shadow-2xl">
               <p className="text-[10px] font-bold text-spa-gold uppercase tracking-widest">Modo Reagendar — Haz clic en un horario disponible</p>
               <button onClick={() => { setAdminRescheduleSlot(null); setRescheduleApptId(null); }} className="p-2 bg-spa-elevated rounded-full hover:text-spa-crema transition-colors"><X size={16}/></button>
             </div>
           )}

           {/* Admin Panel */}
          {showAdminPanel && isAdminAuth && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] bg-spa-base/90 backdrop-blur-xl flex items-center justify-center p-6"
            >
              <div className="w-full max-w-2xl bg-spa-card rounded-[40px] border border-white/10 shadow-2xl h-[80vh] flex flex-col">
                <div className="p-6 sm:p-10 border-b border-white/5 flex justify-between items-center">
                  <h2 className="text-3xl font-serif">Administración</h2>
                  <button
                    onClick={() => setShowAdminPanel(false)}
                    className="p-3 bg-spa-elevated rounded-full hover:text-spa-gold"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 sm:p-10 space-y-12 no-scrollbar">
                  {/* Selector de Ubicación a Configurar */}
                  <div className="space-y-4 p-5 bg-spa-elevated/40 border border-white/5 rounded-2xl">
                    <label className="text-[10px] font-bold text-spa-gold uppercase tracking-widest block">Ubicación a Configurar:</label>
                    <div className="flex gap-4 items-center">
                      <select
                        value={selectedAdminLocation?.id || ""}
                        onChange={(e) => {
                          const found = locations.find(l => l.id === e.target.value);
                          if (found) setSelectedAdminLocation(found);
                        }}
                        className="flex-1 h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm text-spa-crema cursor-pointer"
                      >
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setShowLocationModal(true)}
                        className="h-11 px-4 bg-spa-gold text-spa-base text-[10px] font-bold uppercase tracking-widest rounded-xl hover:bg-spa-accent transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <Plus size={14} /> Nueva Ciudad
                      </button>
                    </div>
                    {selectedAdminLocation && (
                      <div className="flex justify-between items-center text-xs text-[#7A7D7B] px-1 mt-1">
                        <span>Dirección: <em>{selectedAdminLocation.address}</em></span>
                        <button
                          onClick={async () => {
                            if (locations.length <= 1) {
                              toast.error("Debe existir al menos una ubicación.");
                              return;
                            }
                            if (confirm(`¿Estás seguro de que deseas eliminar la ubicación "${selectedAdminLocation.name}"?`)) {
                              try {
                                await fetch(`/api/locations/${selectedAdminLocation.id}`, { method: "DELETE" });
                                toast.success("Ubicación eliminada");
                                const updated = locations.filter(l => l.id !== selectedAdminLocation.id);
                                setLocations(updated);
                                setSelectedAdminLocation(updated[0] || null);
                                if (selectedLocation?.id === selectedAdminLocation.id) {
                                  setSelectedLocation(updated[0] || null);
                                }
                              } catch {
                                toast.error("Error al eliminar la ubicación");
                              }
                            }
                          }}
                          className="text-rose-500 hover:text-rose-400 flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={12} /> Eliminar esta ciudad
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Gestión de Horarios */}
                  <div className="space-y-8">
                    <h3 className="text-[11px] font-bold text-spa-gold uppercase tracking-[0.4em]">
                      Gestión de Horarios {selectedAdminLocation ? `(${selectedAdminLocation.name})` : ""}
                    </h3>

                    {/* Morning */}
                    <div className="space-y-4">
                      <p className="text-[10px] text-[#7A7D7B] font-bold uppercase">Mañana</p>
                      <div className="flex flex-wrap gap-2">
                        {(selectedAdminLocation ? selectedAdminLocation.morningHours : config.morningHours || []).map((h) => (
                          <div
                            key={h}
                            className="bg-spa-elevated px-4 py-2 rounded-xl flex items-center gap-3 border border-white/5 group hover:border-rose-500/50 transition-colors"
                          >
                            <span className="text-sm font-medium">{h}</span>
                            <button
                              onClick={() => {
                                if (selectedAdminLocation) {
                                  handleUpdateLocationConfig(selectedAdminLocation.id, {
                                    morningHours: selectedAdminLocation.morningHours.filter((x) => x !== h),
                                  });
                                } else {
                                  handleUpdateConfig({
                                    ...config,
                                    morningHours: config.morningHours.filter((x) => x !== h),
                                  });
                                }
                              }}
                              className="text-[#7A7D7B] hover:text-rose-500 cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-3">
                        <input
                          type="time"
                          value={newMorningHour}
                          onChange={(e) => setNewMorningHour(e.target.value)}
                          className="flex-1 h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm"
                        />
                        <button
                          onClick={() => handleAddHour("morning")}
                          className="bg-spa-accent/10 px-4 py-2 rounded-xl border border-spa-accent/30 text-spa-gold flex items-center gap-2 hover:bg-spa-accent/20 transition-all cursor-pointer"
                        >
                          <Plus size={14} />
                          <span className="text-[10px] font-bold uppercase">Añadir</span>
                        </button>
                      </div>
                    </div>

                    {/* Afternoon */}
                    <div className="space-y-4">
                      <p className="text-[10px] text-[#7A7D7B] font-bold uppercase">Tarde</p>
                      <div className="flex flex-wrap gap-2">
                        {(selectedAdminLocation ? selectedAdminLocation.afternoonHours : config.afternoonHours || []).map((h) => (
                          <div
                            key={h}
                            className="bg-spa-elevated px-4 py-2 rounded-xl flex items-center gap-3 border border-white/5 group hover:border-rose-500/50 transition-colors"
                          >
                            <span className="text-sm font-medium">{h}</span>
                            <button
                              onClick={() => {
                                if (selectedAdminLocation) {
                                  handleUpdateLocationConfig(selectedAdminLocation.id, {
                                    afternoonHours: selectedAdminLocation.afternoonHours.filter((x) => x !== h),
                                  });
                                } else {
                                  handleUpdateConfig({
                                    ...config,
                                    afternoonHours: config.afternoonHours.filter((x) => x !== h),
                                  });
                                }
                              }}
                              className="text-[#7A7D7B] hover:text-rose-500 cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-3">
                        <input
                          type="time"
                          value={newAfternoonHour}
                          onChange={(e) => setNewAfternoonHour(e.target.value)}
                          className="flex-1 h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm"
                        />
                        <button
                          onClick={() => handleAddHour("afternoon")}
                          className="bg-spa-accent/10 px-4 py-2 rounded-xl border border-spa-accent/30 text-spa-gold flex items-center gap-2 hover:bg-spa-accent/20 transition-all cursor-pointer"
                        >
                          <Plus size={14} />
                          <span className="text-[10px] font-bold uppercase">Añadir</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Estudio */}
                  <div className="space-y-6">
                    <h3 className="text-[11px] font-bold text-spa-gold uppercase tracking-[0.4em]">
                      Estudio
                    </h3>

                    <div className="relative h-36 rounded-2xl overflow-hidden border border-white/10">
                      <img
                        src={config.bannerUrl}
                        alt="Banner del estudio"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-spa-base/60 to-transparent" />
                    </div>

                    <label className="block w-full cursor-pointer">
                      <span className="w-full flex items-center justify-center py-4 rounded-xl bg-spa-elevated border border-white/5 text-spa-gold font-bold uppercase text-[10px] tracking-widest hover:border-spa-gold transition-all">
                        Cambiar imagen
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            const r = new FileReader();
                            r.onload = (ev) =>
                              handleUpdateConfig({
                                ...config,
                                bannerUrl: ev.target?.result as string,
                              });
                            r.readAsDataURL(f);
                          }
                        }}
                      />
                    </label>

                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-spa-gold uppercase tracking-widest px-1">Dirección del Estudio</label>
                      <div className="flex gap-2">
                        <input
                          value={config.address}
                          onChange={(e) => setConfig(prev => ({ ...prev, address: e.target.value }))}
                          placeholder="Calle, número, ciudad..."
                          className="flex-1 h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm"
                        />
                          <button
                            onClick={() => handleUpdateConfig({ ...config, address: config.address })}
                            className="px-5 h-11 rounded-xl bg-spa-gold text-spa-base text-[10px] font-bold uppercase tracking-widest hover:bg-spa-accent transition-all shrink-0"
                          >
                            <Check size={14} className="inline mr-1" />OK
                          </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-spa-gold uppercase tracking-widest px-1">Frase (Tagline)</label>
                      <div className="flex gap-2">
                        <input value={config.tagline || ""} onChange={e => setConfig(prev => ({ ...prev, tagline: e.target.value }))} placeholder="La energía que fluye" className="flex-1 h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm" />
                        <button onClick={() => handleUpdateConfig({ ...config, tagline: config.tagline })} className="px-5 h-11 rounded-xl bg-spa-gold text-spa-base text-[10px] font-bold uppercase tracking-widest hover:bg-spa-accent transition-all shrink-0"><Check size={14} className="inline mr-1" />OK</button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-spa-gold uppercase tracking-widest px-1">Teléfono de WhatsApp (Ej: 34623101111)</label>
                      <div className="flex gap-2">
                        <input 
                          value={config.phone || ""} 
                          onChange={e => setConfig(prev => ({ ...prev, phone: e.target.value.replace(/[^0-9]/g, "") }))} 
                          placeholder="Código de país + número (ej. 34623101111)" 
                          className="flex-1 h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm" 
                        />
                        <button 
                          onClick={() => handleUpdateConfig({ ...config, phone: config.phone })} 
                          className="px-5 h-11 rounded-xl bg-spa-gold text-spa-base text-[10px] font-bold uppercase tracking-widest hover:bg-spa-accent transition-all shrink-0"
                        >
                          <Check size={14} className="inline mr-1" />OK
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-spa-gold uppercase tracking-widest px-1">Logo del Estudio</label>
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-spa-gold/30 shrink-0 bg-spa-elevated flex items-center justify-center">
                          {config?.logoUrl ? (
                            <img
                              src={config.logoUrl}
                              alt="Logo"
                              className="w-full h-full object-cover"
                              style={{ objectPosition: `${(config.logoPosition || { x: 50, y: 50 }).x}% ${(config.logoPosition || { x: 50, y: 50 }).y}%` }}
                            />
                          ) : (
                            <span className="text-[9px] text-[#7A7D7B] uppercase tracking-widest">Logo</span>
                          )}
                        </div>
                        <div className="flex-1 space-y-2">
                          <label className="block w-full cursor-pointer">
                            <span className="w-full flex items-center justify-center py-3 rounded-xl bg-spa-elevated border border-white/5 text-spa-gold font-bold uppercase text-[9px] tracking-widest hover:border-spa-gold transition-all">
                              Subir logo
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  const r = new FileReader();
                                  r.onload = (ev) =>
                                    handleUpdateConfig({
                                      ...config,
                                      logoUrl: ev.target?.result as string,
                                    });
                                  r.readAsDataURL(f);
                                }
                              }}
                            />
                          </label>
                          {config.logoUrl && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleUpdateConfig({ ...config, logoPosition: { x: Math.max(0, (config.logoPosition || { x: 50, y: 50 }).x - 5), y: (config.logoPosition || { x: 50, y: 50 }).y } })}
                                className="p-1.5 bg-spa-elevated rounded-lg hover:text-spa-gold transition-colors text-[#7A7D7B]"
                                title="Mover izquierda"
                              >←</button>
                              <button
                                onClick={() => handleUpdateConfig({ ...config, logoPosition: { x: (config.logoPosition || { x: 50, y: 50 }).x, y: Math.max(0, (config.logoPosition || { x: 50, y: 50 }).y - 5) } })}
                                className="p-1.5 bg-spa-elevated rounded-lg hover:text-spa-gold transition-colors text-[#7A7D7B]"
                                title="Mover arriba"
                              >↑</button>
                              <button
                                onClick={() => handleUpdateConfig({ ...config, logoPosition: { x: (config.logoPosition || { x: 50, y: 50 }).x, y: Math.min(100, (config.logoPosition || { x: 50, y: 50 }).y + 5) } })}
                                className="p-1.5 bg-spa-elevated rounded-lg hover:text-spa-gold transition-colors text-[#7A7D7B]"
                                title="Mover abajo"
                              >↓</button>
                              <button
                                onClick={() => handleUpdateConfig({ ...config, logoPosition: { x: Math.min(100, (config.logoPosition || { x: 50, y: 50 }).x + 5), y: (config.logoPosition || { x: 50, y: 50 }).y } })}
                                className="p-1.5 bg-spa-elevated rounded-lg hover:text-spa-gold transition-colors text-[#7A7D7B]"
                                title="Mover derecha"
                              >→</button>
                              <button
                                onClick={() => handleUpdateConfig({ ...config, logoUrl: "", logoPosition: { x: 50, y: 50 } })}
                                className="p-1.5 bg-rose-500/10 rounded-lg hover:bg-rose-500/30 text-rose-500 transition-colors ml-1"
                                title="Eliminar logo"
                              >✕</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </motion.div>
          )}


          {/* Clientes y Citas */}
          {showClientsPage && isAdminAuth && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] bg-spa-base/90 backdrop-blur-xl flex items-center justify-center p-6"
            >
              <div className="w-full max-w-2xl bg-spa-card rounded-[40px] border border-white/10 shadow-2xl max-h-[85vh] flex flex-col">
                <div className="p-6 sm:p-10 pb-6 border-b border-white/5 flex justify-between items-center">
                  <h2 className="text-3xl font-serif">Clientes y Citas</h2>
                  <button onClick={() => setShowClientsPage(false)} className="p-3 bg-spa-elevated rounded-full hover:text-spa-gold"><X size={20}/></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 sm:p-10 space-y-8 no-scrollbar">
                  {/* Weekly Schedule */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <button onClick={() => setCalendarMonth(d => addDays(d, -7))} className="p-1.5 text-[#7A7D7B] hover:text-spa-gold transition-colors"><ChevronLeft size={16}/></button>
                      <h3 className="text-[10px] font-bold text-spa-gold uppercase tracking-[0.3em]">{format(calendarMonth, "d MMM", { locale: es })} — {format(addDays(calendarMonth, 6), "d MMM yyyy", { locale: es })}</h3>
                      <button onClick={() => setCalendarMonth(d => addDays(d, 7))} className="p-1.5 text-[#7A7D7B] hover:text-spa-gold transition-colors"><ChevronRight size={16}/></button>
                    </div>
                    <div className="overflow-x-auto no-scrollbar -mx-6 sm:-mx-10">
                      <div className="min-w-[550px] px-6 sm:px-10">
                        <div className="grid grid-cols-[45px_repeat(7,1fr)] gap-px">
                          <div />
                          {Array.from({length: 7}, (_, i) => addDays(calendarMonth, i)).map((day, i) => {
                            const today = isSameDay(day, startOfToday());
                            const sel = selectedCalendarDay && isSameDay(day, selectedCalendarDay);
                            const appts = appointments.filter(a => isSameDay(parseISO(a.startTime), day));
                            const dayBlocked = isDayBlocked(day);
                            const mornBlocked = isShiftBlocked(day, "morning");
                            const aftBlocked = isShiftBlocked(day, "afternoon");
                            return (
                              <button key={i} onClick={() => setSelectedCalendarDay(sel ? null : day)}
                                className={cn("text-center py-1.5 rounded-lg transition-all relative", sel ? "bg-spa-gold text-spa-base" : today ? "bg-spa-accent/20" : "hover:bg-spa-accent/10", dayBlocked && "opacity-50")}
                              >
                                <div className="text-[6px] font-bold uppercase tracking-wider opacity-60">{format(day, "EEEEE", { locale: es })}</div>
                                <div className="text-[11px] font-bold">{format(day, "d")}</div>
                                <div className="flex justify-center gap-0.5 mt-0.5">
                                  <span className={cn("w-1 h-1 rounded-full", mornBlocked ? "bg-rose-500" : appts.length > 0 ? "bg-spa-gold" : "bg-transparent")} />
                                  <span className={cn("w-1 h-1 rounded-full", aftBlocked ? "bg-rose-500" : appts.length > 0 ? "bg-spa-gold" : "bg-transparent")} />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-2 space-y-px">
                          {((selectedAdminLocation ? [...selectedAdminLocation.morningHours, ...selectedAdminLocation.afternoonHours] : [...config.morningHours, ...config.afternoonHours]) as string[]).map(hour => {
                            const [hh, mm] = hour.split(":").map(Number);
                            const isMorn = (selectedAdminLocation ? selectedAdminLocation.morningHours : config.morningHours || []).includes(hour);
                            return (
                              <div key={hour} className={cn("grid grid-cols-[45px_repeat(7,1fr)] gap-px border-t border-white/5 py-0.5")}>
                                <div className="text-[7px] text-[#7A7D7B] font-mono text-right pr-1.5 leading-8">{hour}</div>
                                {Array.from({length: 7}, (_, i) => {
                                  const day = addDays(calendarMonth, i);
                                  const slotBlocked = isDayBlocked(day) || (isMorn ? isShiftBlocked(day, "morning") : isShiftBlocked(day, "afternoon"));
                                  const appt = appointments.find(a =>
                                    isSameDay(parseISO(a.startTime), day) &&
                                    parseISO(a.startTime).getHours() === hh &&
                                    parseISO(a.startTime).getMinutes() === mm
                                  );
                                  return (
                                    <div key={i} className="min-h-[32px]">
                                      {appt ? (
                                        <div onClick={() => { setViewingAppt(appt); setShowClientsPage(false); }} className={cn("h-full bg-spa-accent/15 border border-spa-accent/30 rounded-md px-1.5 py-1 flex flex-col justify-center cursor-pointer hover:bg-spa-accent/25 transition-colors", slotBlocked && "opacity-50")}>
                                          <p className="text-[7px] font-bold text-spa-crema leading-tight truncate">{appt.clientName.split(" ")[0]}</p>
                                          <p className="text-[6px] text-[#B8BBB9] leading-tight truncate">{appt.massageType?.split(" ").slice(0,2).join(" ") || "Masaje"}</p>
                                        </div>
                                      ) : slotBlocked ? (
                                        <div className="h-full flex items-center justify-center">
                                          <div className="w-full h-full bg-rose-500/5 border border-rose-500/10 rounded-md flex items-center justify-center">
                                            <Lock size={8} className="text-rose-500/40" />
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {selectedCalendarDay && (
                      <>
                        <div className="text-center text-[8px] text-spa-gold font-bold uppercase tracking-widest">
                          {format(selectedCalendarDay, "EEEE d 'de' MMMM", { locale: es })} — {appointments.filter(a => isSameDay(parseISO(a.startTime), selectedCalendarDay)).length} cita(s)
                        </div>
                        <div className="flex justify-center gap-2 mt-1.5">
                          <button onClick={() => toggleDayBlock(selectedCalendarDay)} className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[7px] font-bold uppercase tracking-wider transition-all", isDayBlocked(selectedCalendarDay) ? "bg-rose-500/15 border-rose-500/40 text-rose-400" : "bg-spa-elevated border-white/5 text-[#7A7D7B] hover:text-spa-crema")}>
                            {isDayBlocked(selectedCalendarDay) ? <Lock size={10} /> : <Unlock size={10} />} Día
                          </button>
                          <button onClick={() => toggleShiftBlock(selectedCalendarDay, "morning")} className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[7px] font-bold uppercase tracking-wider transition-all", isShiftBlocked(selectedCalendarDay, "morning") ? "bg-rose-500/15 border-rose-500/40 text-rose-400" : "bg-spa-elevated border-white/5 text-[#7A7D7B] hover:text-spa-crema")}>
                            {isShiftBlocked(selectedCalendarDay, "morning") ? <Lock size={10} /> : <Unlock size={10} />} Mañana
                          </button>
                          <button onClick={() => toggleShiftBlock(selectedCalendarDay, "afternoon")} className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[7px] font-bold uppercase tracking-wider transition-all", isShiftBlocked(selectedCalendarDay, "afternoon") ? "bg-rose-500/15 border-rose-500/40 text-rose-400" : "bg-spa-elevated border-white/5 text-[#7A7D7B] hover:text-spa-crema")}>
                            {isShiftBlocked(selectedCalendarDay, "afternoon") ? <Lock size={10} /> : <Unlock size={10} />} Tarde
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Próximas Citas */}
                  <div className="space-y-4">
                    <h3 className="text-[11px] font-bold text-spa-gold uppercase tracking-[0.4em]">Próximas Citas</h3>
                    {(() => {
                      const upcoming = appointments.filter(a => isAfter(parseISO(a.startTime), new Date())).sort((a,b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime());
                      return upcoming.length === 0 ? (
                        <div className="bg-spa-elevated border border-white/5 rounded-2xl p-6 text-center"><p className="text-sm text-[#7A7D7B]">Sin citas próximas</p></div>
                      ) : (
                        <div className="space-y-2">
                          {upcoming.map(appt => (
                            <div key={appt.id} className="bg-spa-card px-4 py-4 rounded-xl border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-3.5">
                              {/* Left Side: Time and Client Details */}
                              <div className="flex items-center gap-3">
                                <div className="text-center min-w-[50px] shrink-0 bg-spa-elevated py-1.5 px-2 rounded-lg border border-white/5">
                                  <p className="text-base font-bold font-serif text-spa-gold leading-none">{format(parseISO(appt.startTime), "HH:mm")}</p>
                                  <p className="text-[7px] text-[#7A7D7B] uppercase mt-1 leading-none">{format(parseISO(appt.startTime), "d MMM", { locale: es })}</p>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-spa-crema truncate leading-snug">{appt.clientName}</p>
                                  <p className="text-[9px] text-[#7A7D7B] truncate leading-normal mt-0.5">{appt.massageType || "Masaje"} • {appt.clientEmail}</p>
                                </div>
                              </div>

                              {/* Right Side: Status Badge and Actions */}
                              <div className="flex flex-wrap items-center justify-between md:justify-end gap-2 pt-2 md:pt-0 border-t border-white/5 md:border-t-0 shrink-0">
                                <span className={`px-2 py-0.5 rounded-full text-[6px] font-bold uppercase tracking-wider border shrink-0 ${getStatusInfo(appt.status).className}`}>
                                  {getStatusInfo(appt.status).label}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <button onClick={() => { setEmailAppointment(appt); setShowEmailModal(true); }} className="px-2.5 py-1.5 rounded-lg text-[8px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-white transition-all flex items-center gap-1" title="Correo">
                                    <Mail size={11} /> <span>Email</span>
                                  </button>
                                  <button onClick={() => handleAddToCalendar(appt)} className="px-2.5 py-1.5 rounded-lg text-[8px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all flex items-center gap-1" title="Calendario">
                                    <CalendarIcon size={11} /> <span>Cal</span>
                                  </button>
                                  <button onClick={() => { setViewingAppt(appt); setShowClientsPage(false); }} className="px-2.5 py-1.5 rounded-lg text-[8px] font-bold uppercase tracking-wider bg-spa-accent/10 text-spa-gold hover:bg-spa-accent hover:text-spa-base transition-all flex items-center gap-1">
                                    <Eye size={11} /> <span>Ver</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Historial e Ingresos */}
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <h3 className="text-[11px] font-bold text-spa-gold uppercase tracking-[0.4em]">Historial e Ingresos</h3>
                      <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto shrink-0">
                        <input
                          type="text"
                          placeholder="Buscar cliente, email o masaje..."
                          value={historySearchQuery}
                          onChange={(e) => setHistorySearchQuery(e.target.value)}
                          className="h-8 bg-spa-elevated border border-white/5 rounded-xl px-3 outline-none focus:border-spa-gold text-[10px] text-spa-crema placeholder-[#7A7D7B] w-full sm:w-44 transition-colors"
                        />
                        <select
                          value={historyFilterStatus}
                          onChange={(e) => setHistoryFilterStatus(e.target.value)}
                          className="h-8 bg-spa-elevated border border-white/5 rounded-xl px-3 outline-none focus:border-spa-gold text-[10px] text-spa-crema w-full sm:w-32 transition-colors cursor-pointer"
                        >
                          <option value="all">Todos los estados</option>
                          <option value="pending">Pendientes</option>
                          <option value="attending">Asistirá</option>
                          <option value="rescheduled">Reagendadas</option>
                          <option value="cancelled">Canceladas</option>
                        </select>
                      </div>
                    </div>

                    {(() => {
                      const allAppts = [...appointments]
                        .filter(appt => {
                          const matchesStatus = historyFilterStatus === "all" || appt.status === historyFilterStatus;
                          const matchesSearch = 
                            appt.clientName.toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                            (appt.clientEmail || "").toLowerCase().includes(historySearchQuery.toLowerCase()) ||
                            (appt.clientPhone || "").includes(historySearchQuery) ||
                            (appt.massageType || "").toLowerCase().includes(historySearchQuery.toLowerCase());
                          return matchesStatus && matchesSearch;
                        })
                        .sort((a,b) => parseISO(b.startTime).getTime() - parseISO(a.startTime).getTime());

                      const getPrice = (appt: any) => {
                        if (appt.price) { const n = parseFloat(appt.price.replace(/[€$,]/g, "")); if (!isNaN(n)) return n; }
                        const m = (config.massageTypes || []).find(t => t.name === appt.massageType);
                        return m?.price ? parseFloat(m.price.replace(/[€$,]/g, "")) : 0;
                      };
                      const ingresos = appointments.reduce((t, a) => t + getPrice(a), 0);
                      const pasadas = appointments.filter(a => isBefore(parseISO(a.startTime), new Date())).length;
                      const pendientes = appointments.length - pasadas;
                      return (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <div className="bg-spa-elevated p-4 rounded-xl border border-white/5 col-span-2 sm:col-span-1">
                              <p className="text-[9px] text-[#7A7D7B] font-bold uppercase mb-1">Ingresos Totales</p>
                              <p className="text-xl font-serif text-spa-gold">{ingresos.toFixed(2)}€</p>
                            </div>
                            <div className="bg-spa-elevated p-4 rounded-xl border border-white/5 col-span-1">
                              <p className="text-[9px] text-[#7A7D7B] font-bold uppercase mb-1">Completadas</p>
                              <p className="text-xl font-serif text-spa-crema">{pasadas}</p>
                            </div>
                            <div className="bg-spa-elevated p-4 rounded-xl border border-white/5 col-span-1">
                              <p className="text-[9px] text-[#7A7D7B] font-bold uppercase mb-1">Pendientes</p>
                              <p className="text-xl font-serif text-spa-gold">{pendientes}</p>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {allAppts.length === 0 ? (
                              <div className="bg-spa-elevated border border-white/5 rounded-2xl p-6 text-center">
                                <p className="text-sm text-[#7A7D7B]">No se encontraron citas que coincidan con la búsqueda</p>
                              </div>
                            ) : (
                              allAppts.slice(0, 50).map(appt => {
                                const isPast = isBefore(parseISO(appt.startTime), new Date());
                                const price = getPrice(appt);
                                return (
                                  <div key={appt.id} className="bg-spa-elevated px-4 py-4 rounded-xl border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-3 group">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate text-spa-crema">{appt.clientName}</p>
                                      <p className="text-[9px] text-[#7A7D7B] truncate mt-1">
                                        {format(parseISO(appt.startTime), "d MMM yyyy", { locale: es })} • {appt.massageType || "Sin tipo"}
                                        {(() => { const mt = (config.massageTypes || []).find(t => t.name === appt.massageType); return mt?.intensity ? <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[6px] font-bold uppercase border ${getIntensityInfo(mt.intensity).className}`}>{getIntensityInfo(mt.intensity).label}</span> : null; })()}
                                        {isPast && <span className="ml-1 text-emerald-500">✓</span>}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between md:justify-end gap-2 pt-2 md:pt-0 border-t border-white/5 md:border-t-0 shrink-0">
                                      <span className={`px-1.5 py-0.5 rounded-md text-[6px] font-bold uppercase tracking-wider border shrink-0 ${getStatusInfo(appt.status).className}`}>
                                        {getStatusInfo(appt.status).label}
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <button onClick={() => { setEmailAppointment(appt); setShowEmailModal(true); }} className="p-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-white rounded-lg transition-all" title="Correo"><Mail size={12}/></button>
                                        <button onClick={() => handleAddToCalendar(appt)} className="p-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-lg transition-all" title="Calendario"><CalendarIcon size={12}/></button>
                                        <span className="text-xs font-bold text-spa-gold mx-1 shrink-0">{price > 0 ? `${price.toFixed(2)}€` : "—"}</span>
                                        <button onClick={() => handleAdminDelete(appt)} className="p-1.5 bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white rounded-lg transition-all"><Trash2 size={12}/></button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Servicios */}
          {showServices && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] bg-spa-base/90 backdrop-blur-xl flex items-center justify-center p-6"
            >
              <div className="w-full max-w-2xl bg-spa-card rounded-[40px] border border-white/10 shadow-2xl max-h-[80vh] flex flex-col">
                <div className="p-6 sm:p-10 pb-6 border-b border-white/5 flex justify-between items-center">
                  <h2 className="text-3xl font-serif">Servicios</h2>
                  <button
                    onClick={() => setShowServices(false)}
                    className="p-3 bg-spa-elevated rounded-full hover:text-spa-gold"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 sm:p-10 space-y-4 no-scrollbar">
                  {config.massageTypes.length === 0 ? (
                    <div className="bg-spa-elevated border border-white/5 rounded-2xl p-10 text-center">
                      <p className="text-sm text-[#7A7D7B]">No hay servicios disponibles</p>
                    </div>
                  ) : (
                    config.massageTypes.map((m) => (
                      <div
                        key={m.id}
                        className="bg-spa-elevated rounded-2xl border border-white/5 p-6 flex items-center justify-between gap-6 hover:border-spa-gold/40 hover:shadow-[0_0_30px_rgba(201,169,110,0.08)] hover:scale-[1.01] transition-all duration-300 group"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-serif text-spa-crema">{m.name}</h3>
                            {m.intensity && (
                              <span className={`px-2 py-0.5 rounded-md text-[7px] font-bold uppercase tracking-wider border ${getIntensityInfo(m.intensity).className}`}>
                                {getIntensityInfo(m.intensity).label}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 mt-2">
                            <span className="text-sm font-bold text-spa-gold">{m.price}</span>
                            <span className="text-[10px] text-[#7A7D7B] uppercase tracking-widest">{m.duration}</span>
                          </div>
                          {m.description && (
                            <p className="text-xs text-spa-crema/70 mt-3 leading-relaxed">{m.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isAdminAuth ? (
                            <>
                              <button
                                onClick={() => {
                                  setEditMassageId(m.id);
                                  setNewMassage({ name: m.name, price: m.price, duration: m.duration, description: m.description || "", intensity: m.intensity || "" });
                                  setShowServiciosEditModal(true);
                                }}
                                className="p-2 text-[#7A7D7B] hover:text-spa-gold transition-colors"
                                title="Editar servicio"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                              </button>
                              <button
                                onClick={() =>
                                  handleUpdateConfig({
                                    ...config,
                                    massageTypes: config.massageTypes.filter((x) => x.id !== m.id),
                                  })
                                }
                                className="p-2 text-[#7A7D7B] hover:text-rose-500 transition-colors"
                                title="Eliminar servicio"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                setFormData(prev => ({ ...prev, massageType: m.name }));
                                setShowServices(false);
                              }}
                              className="px-6 py-3 rounded-xl bg-spa-gold text-spa-base text-[10px] font-bold uppercase tracking-widest hover:bg-spa-accent hover:text-spa-base transition-all"
                            >
                              Reservar
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}

                  {isAdminAuth && !editMassageId && (
                    <div className="pt-6 space-y-4">
                      <div className="grid grid-cols-1 gap-3">
                        <textarea
                          value={newMassage.description}
                          onChange={(e) => setNewMassage((prev) => ({ ...prev, description: e.target.value }))}
                          placeholder="Descripción del servicio"
                          rows={3}
                          className="h-24 bg-spa-elevated border border-white/5 rounded-xl px-4 py-3 outline-none focus:border-spa-gold text-sm resize-none"
                        />
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <input
                            value={newMassage.name}
                            onChange={(e) => setNewMassage((prev) => ({ ...prev, name: e.target.value }))}
                            placeholder="Nombre"
                            className="h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm"
                          />
                          <input
                            value={newMassage.price}
                            onChange={(e) => setNewMassage((prev) => ({ ...prev, price: e.target.value }))}
                            placeholder="Precio"
                            className="h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm"
                          />
                          <input
                            value={newMassage.duration}
                            onChange={(e) => setNewMassage((prev) => ({ ...prev, duration: e.target.value }))}
                            placeholder="Duración"
                            className="h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm"
                          />
                        </div>
                        <select
                          value={newMassage.intensity}
                          onChange={(e) => setNewMassage((prev) => ({ ...prev, intensity: e.target.value }))}
                          className="h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm"
                        >
                          <option value="">Sin intensidad</option>
                          {intensityOptions.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleAddMassageType}
                          className="flex-1 py-4 border-2 border-dashed border-spa-accent/30 rounded-xl text-spa-gold text-[10px] font-bold uppercase tracking-widest hover:bg-spa-accent/10 transition-all flex items-center justify-center gap-2"
                        >
                          {editMassageId ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg> : <Plus size={16} />}
                          {editMassageId ? "Guardar Cambios" : "Añadir Servicio"}
                        </button>
                        {editMassageId && (
                          <button
                            onClick={() => { setEditMassageId(null); setNewMassage({ name: "", price: "", duration: "", description: "", intensity: "" }); }}
                            className="px-6 py-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[10px] font-bold uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all"
                          >
                            Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Email Modal */}
          {showEmailModal && emailAppointment && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[200] bg-spa-base/60 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div initial={{ y: 30, opacity: 0, scale: 0.95 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0, scale: 0.95 }} transition={{ type: "spring", damping: 28, stiffness: 300 }} className="w-full max-w-md bg-spa-card rounded-[24px] border border-white/10 shadow-2xl overflow-hidden p-6">
                <div className="flex justify-between items-center mb-5">
                  <h3 className="text-xl font-serif">Enviar Correo</h3>
                  <button onClick={() => { setShowEmailModal(false); setEmailAppointment(null); setEmailTemplate("reminder"); setEmailCustomText(""); setShowEmailCustomInput(false); }} className="p-1.5 bg-spa-elevated rounded-full hover:text-spa-gold transition-colors"><X size={18}/></button>
                </div>
                <div className="bg-gradient-to-r from-spa-accent/20 to-transparent p-4 rounded-xl border border-spa-gold/20 mb-5">
                  <p className="text-sm font-serif">{emailAppointment.clientName}</p>
                  <p className="text-[10px] text-spa-gold mt-1">{emailAppointment.clientEmail}</p>
                  <p className="text-[9px] text-[#7A7D7B] mt-0.5">{emailAppointment.massageType} • {format(parseISO(emailAppointment.startTime), "d MMM, HH:mm", { locale: es })}</p>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <select value={emailTemplate} onChange={e => {
                      const val = e.target.value;
                      setEmailTemplate(val);
                      if (val === "custom" && emailAppointment) {
                        setEmailCustomText(`Te escribo para informarte sobre tu cita de ${emailAppointment.massageType || 'servicio'} el ${format(parseISO(emailAppointment.startTime), "EEEE d 'de' MMMM", { locale: es })} a las ${format(parseISO(emailAppointment.startTime), "HH:mm")}.${emailAppointment.duration ? ` Duración: ${emailAppointment.duration}.` : ''}\n\nPor favor, confirma que podrás asistir o avísanos si necesitas cambiar algo.`);
                        setShowEmailCustomInput(true);
                      }
                    }} className="flex-1 h-11 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm">
                      <option value="reminder">Recordatorio de Cita</option>
                      <option value="address">Dirección del Estudio</option>
                      <option value="custom">Personalizado</option>
                    </select>
                    <button onClick={() => setShowEmailCustomInput(!showEmailCustomInput)} className="w-11 h-11 bg-spa-elevated border border-white/5 rounded-xl flex items-center justify-center text-spa-gold hover:border-spa-gold transition-all shrink-0">
                      {showEmailCustomInput ? <X size={18}/> : <Plus size={18}/>}
                    </button>
                  </div>
                  {showEmailCustomInput && (
                    <textarea value={emailCustomText} onChange={e => setEmailCustomText(e.target.value)} placeholder="Escribe un mensaje adicional para el cliente..." rows={5} className="w-full bg-spa-elevated border border-white/5 rounded-xl px-4 py-3 outline-none focus:border-spa-gold text-sm resize-none" />
                  )}
                  <button onClick={handleSendCustomEmail} className="w-full h-12 bg-spa-gold text-spa-base font-bold uppercase tracking-[0.2em] rounded-xl hover:opacity-90 active:scale-95 transition-all text-xs shadow-xl">
                    Enviar Correo
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* Custom Confirmation Modal */}
          <AnimatePresence>
            {cancelModalData && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                className="absolute inset-0 z-[250] bg-spa-base/60 backdrop-blur-md flex items-center justify-center p-4"
              >
                <motion.div 
                  initial={{ y: 30, opacity: 0, scale: 0.95 }} 
                  animate={{ y: 0, opacity: 1, scale: 1 }} 
                  exit={{ y: 30, opacity: 0, scale: 0.95 }} 
                  transition={{ type: "spring", damping: 28, stiffness: 300 }} 
                  className="w-full max-w-md bg-spa-card rounded-[24px] border border-white/10 shadow-2xl overflow-hidden p-6 space-y-6 animate-fade-in"
                >
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-serif text-spa-crema">
                      {cancelModalData.mode === "admin_delete" ? "Eliminar Cita" : "Cancelar Cita"}
                    </h3>
                    <button 
                      onClick={() => { setCancelModalData(null); setCancelReason(""); }} 
                      className="p-1.5 bg-spa-elevated rounded-full hover:text-spa-gold hover:scale-105 active:scale-95 transition-all cursor-pointer"
                      disabled={isCancellingAppt}
                    >
                      <X size={18}/>
                    </button>
                  </div>

                  <div className="bg-gradient-to-r from-spa-accent/10 to-transparent p-4 rounded-xl border border-white/5 space-y-2">
                    <p className="text-[9px] text-spa-gold font-bold uppercase tracking-widest">Detalles de la Cita</p>
                    <div className="space-y-1">
                      <p className="text-sm font-serif text-spa-crema">{cancelModalData.appt.clientName}</p>
                      <p className="text-[10px] text-[#7A7D7B]">{cancelModalData.appt.clientEmail} • {cancelModalData.appt.clientPhone}</p>
                      <p className="text-[11px] text-spa-crema/80 font-serif">
                        {format(parseISO(cancelModalData.appt.startTime), "EEEE d 'de' MMMM", { locale: es })}
                        <span className="text-spa-gold font-sans font-bold text-[10px] tracking-wider uppercase ml-2">
                          {format(parseISO(cancelModalData.appt.startTime), "HH:mm")}
                        </span>
                      </p>
                      <p className="text-[10px] text-[#7A7D7B] uppercase tracking-wider mt-1">{cancelModalData.appt.massageType}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {cancelModalData.mode === "admin_delete" && (
                      <p className="text-xs text-[#7A7D7B] leading-relaxed">
                        ¿Estás seguro de que deseas eliminar permanentemente esta cita de la base de datos y del calendario? Esta acción no se puede deshacer y no enviará notificaciones al cliente.
                      </p>
                    )}

                    {cancelModalData.mode === "admin_cancel" && (
                      <div className="space-y-3">
                        <p className="text-xs text-[#7A7D7B] leading-relaxed">
                          ¿Deseas cancelar esta cita? Se eliminará de la agenda y se enviará una notificación de cancelación por correo electrónico al cliente.
                        </p>
                        <div className="space-y-1.5">
                          <label className="text-[9px] text-spa-gold uppercase font-bold tracking-widest">Motivo de cancelación (Opcional)</label>
                          <textarea 
                            value={cancelReason} 
                            onChange={e => setCancelReason(e.target.value)} 
                            placeholder="Ej. El Studio tiene un imprevisto médico, por favor reagenda..." 
                            rows={3} 
                            className="w-full bg-spa-elevated border border-white/5 rounded-xl px-4 py-3 outline-none focus:border-spa-gold text-xs text-spa-crema placeholder-white/20 resize-none transition-all"
                            disabled={isCancellingAppt}
                          />
                        </div>
                      </div>
                    )}

                    {cancelModalData.mode === "client_cancel" && (
                      <p className="text-xs text-[#7A7D7B] leading-relaxed">
                        Lamentamos que tengas que cancelar tu cita. Si confirmas la cancelación, liberaremos este horario para que otra persona pueda disfrutar de su servicio de cejas. ¿Confirmas la cancelación de tu cita?
                      </p>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button 
                      onClick={() => { setCancelModalData(null); setCancelReason(""); }}
                      className="flex-1 py-3.5 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest text-[#7A7D7B] hover:text-spa-crema hover:bg-white/5 active:scale-98 transition-all cursor-pointer"
                      disabled={isCancellingAppt}
                    >
                      Volver
                    </button>
                    <button 
                      onClick={executeCancelAction}
                      className={`flex-1 py-3.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer shadow-lg active:scale-98 flex items-center justify-center gap-2 ${
                        cancelModalData.mode === "admin_delete" || cancelModalData.mode === "client_cancel"
                          ? "bg-rose-500/20 border border-rose-500/40 text-rose-400 hover:bg-rose-500 hover:text-white" 
                          : "bg-spa-gold text-spa-base hover:opacity-90 font-bold"
                      }`}
                      disabled={isCancellingAppt}
                    >
                      {isCancellingAppt ? (
                        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                      ) : cancelModalData.mode === "admin_delete" ? (
                        "Eliminar"
                      ) : (
                        "Confirmar"
                      )}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* New Location Modal */}
          {showLocationModal && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[200] bg-spa-base/60 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div initial={{ y: 30, opacity: 0, scale: 0.95 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0, scale: 0.95 }} transition={{ type: "spring", damping: 28, stiffness: 300 }} className="w-full max-w-md bg-spa-card rounded-[24px] border border-white/10 shadow-2xl overflow-hidden">
                <div className="p-6 space-y-5">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-serif">Nueva Ubicación / Ciudad</h3>
                    <button onClick={() => { setShowLocationModal(false); setNewLocation({ name: "", address: "" }); }} className="p-1.5 bg-spa-elevated rounded-full hover:text-spa-gold transition-colors cursor-pointer"><X size={18}/></button>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-spa-gold uppercase tracking-widest px-1">Nombre de la Ciudad</label>
                      <input value={newLocation.name} onChange={e => setNewLocation(p => ({...p, name: e.target.value}))} placeholder="Ej. Albacete" className="w-full h-12 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm text-spa-crema" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-spa-gold uppercase tracking-widest px-1">Dirección del Estudio</label>
                      <input value={newLocation.address} onChange={e => setNewLocation(p => ({...p, address: e.target.value}))} placeholder="Ej. Calle Mayor 15, Albacete" className="w-full h-12 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm text-spa-crema" />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={async () => {
                        if (!newLocation.name.trim() || !newLocation.address.trim()) {
                          toast.error("Por favor completa todos los campos.");
                          return;
                        }
                        try {
                          const res = await fetch("/api/locations", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(newLocation)
                          });
                          if (res.ok) {
                            toast.success("Ubicación añadida");
                            setShowLocationModal(false);
                            setNewLocation({ name: "", address: "" });
                            fetchLocations();
                          } else {
                            toast.error("Error al añadir ubicación");
                          }
                        } catch {
                          toast.error("Error al añadir ubicación");
                        }
                      }}
                      className="flex-1 py-4 bg-spa-gold text-spa-base rounded-xl text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all cursor-pointer font-extrabold"
                    >
                      Añadir Ciudad
                    </button>
                    <button onClick={() => { setShowLocationModal(false); setNewLocation({ name: "", address: "" }); }} className="px-6 py-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[10px] font-bold uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all cursor-pointer font-extrabold">Cancelar</button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* Edit Massage Modal (Servicios) */}
          {showServiciosEditModal && editMassageId && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[200] bg-spa-base/60 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div initial={{ y: 30, opacity: 0, scale: 0.95 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0, scale: 0.95 }} transition={{ type: "spring", damping: 28, stiffness: 300 }} className="w-full max-w-md bg-spa-card rounded-[24px] border border-white/10 shadow-2xl overflow-hidden">
                <div className="p-6 space-y-5">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-serif">Editar Masaje</h3>
                    <button onClick={() => { setShowServiciosEditModal(false); setEditMassageId(null); setNewMassage({ name: "", price: "", duration: "", description: "", intensity: "" }); }} className="p-1.5 bg-spa-elevated rounded-full hover:text-spa-gold transition-colors"><X size={18}/></button>
                  </div>
                  <div className="space-y-3">
                    <input value={newMassage.name} onChange={e => setNewMassage(p => ({...p, name: e.target.value}))} placeholder="Nombre" className="w-full h-12 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm" />
                    <div className="grid grid-cols-2 gap-3">
                      <input value={newMassage.price} onChange={e => setNewMassage(p => ({...p, price: e.target.value}))} placeholder="Precio" className="h-12 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm" />
                      <input value={newMassage.duration} onChange={e => setNewMassage(p => ({...p, duration: e.target.value}))} placeholder="Duración" className="h-12 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm" />
                    </div>
                    <textarea value={newMassage.description} onChange={e => setNewMassage(p => ({...p, description: e.target.value}))} placeholder="Descripción" rows={3} className="w-full h-24 bg-spa-elevated border border-white/5 rounded-xl px-4 py-3 outline-none focus:border-spa-gold text-sm resize-none" />
                    <select value={newMassage.intensity} onChange={e => setNewMassage(p => ({...p, intensity: e.target.value}))} className="w-full h-12 bg-spa-elevated border border-white/5 rounded-xl px-4 outline-none focus:border-spa-gold text-sm">
                      <option value="">Sin intensidad</option>
                      {intensityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => { handleAddMassageType(); setShowServiciosEditModal(false); }} className="flex-1 py-4 bg-spa-gold text-spa-base rounded-xl text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all">Guardar Cambios</button>
                    <button onClick={() => { setShowServiciosEditModal(false); setEditMassageId(null); setNewMassage({ name: "", price: "", duration: "", description: "", intensity: "" }); }} className="px-6 py-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[10px] font-bold uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all">Cancelar</button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* Info Modal */}
          {infoModalMassage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setInfoModalMassage(null)}
              className="absolute inset-0 z-[150] bg-black/60 backdrop-blur-md flex items-end sm:items-center justify-center p-6"
            >
              <motion.div
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 50, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm bg-spa-card rounded-[24px] sm:rounded-[32px] border border-white/10 shadow-2xl overflow-hidden"
              >
                <div className="p-6 sm:p-8">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-serif text-spa-crema">{infoModalMassage.name}</h3>
                    <button onClick={() => setInfoModalMassage(null)} className="p-1.5 bg-spa-elevated rounded-full hover:text-spa-gold transition-colors"><X size={18}/></button>
                  </div>
                  <p className="text-sm text-spa-crema/70 leading-relaxed">{infoModalMassage.description}</p>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* Bot Interface */}
          {showBot && (
            <>
              {/* Standard Floating Assistant (Hidden during rescheduling step to allow full viewport access) */}
              {botStep !== "reschedule" && (
                <motion.div 
                  initial={{ opacity: 0, y: 20, scale: 0.95 }} 
                  animate={{ opacity: 1, y: 0, scale: 1 }} 
                  exit={{ opacity: 0, y: 20, scale: 0.95 }} 
                  className="fixed bottom-24 right-6 w-[calc(100vw-48px)] max-w-[350px] h-[500px] max-h-[70vh] bg-spa-card border border-white/10 rounded-[28px] shadow-2xl flex flex-col z-50 overflow-hidden glow-gold"
                >
                  <div className="p-5 border-b border-white/5 flex items-center justify-between bg-spa-elevated">
                      <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-spa-gold to-spa-accent flex items-center justify-center text-spa-base font-serif text-lg font-bold">JP</div>
                          <div>
                             <h3 className="text-xs font-bold uppercase tracking-widest">Asistente</h3>
                             <p className="text-[9px] text-spa-gold font-medium">Asistente Virtual</p>
                          </div>
                      </div>
                      <button onClick={()=>setShowBot(false)} className="p-2 text-[#7A7D7B] hover:text-spa-crema"><X size={18}/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
                      <div className="self-start max-w-[85%] bg-spa-elevated p-5 rounded-2xl rounded-tl-sm text-sm font-light leading-relaxed border border-white/5 relative">
                          {botStep === "greeting" 
                            ? "Hola, bienvenido. Soy el asistente de JP Brow Studio. ¿Cómo puedo ayudarte hoy?" 
                            : botStep === "massages" 
                            ? "Aquí tienes los servicios de diseño y depilación de cejas disponibles:" 
                            : botStep === "info" 
                            ? "Esta es nuestra información de contacto físico, horarios y ubicación:" 
                            : botStep === "faq" 
                            ? "Aquí tienes respuestas a las preguntas más frecuentes sobre nuestras sesiones:" 
                            : botStep === "contact"
                            ? "¿Tienes dudas específicas o prefieres atención directa por WhatsApp? Contáctame:"
                            : "Por favor, introduce los datos solicitados:"}
                          <div className="absolute top-0 -left-2 w-4 h-4 bg-spa-elevated clip-path-triangle" />
                      </div>

                      {botStep === "greeting" && (
                          <div className="flex flex-col gap-2.5">
                              <button onClick={() => { setShowBot(false); toast.info("Selecciona un día y hora en el calendario de la web"); }} className="w-full py-3.5 bg-spa-accent text-spa-crema rounded-xl text-[9px] font-bold uppercase tracking-widest hover:bg-spa-gold hover:text-spa-base transition-all shadow-lg flex items-center justify-center gap-2">
                                  📅 Reservar Nueva Cita
                              </button>
                              <button onClick={() => setBotStep("ask_email")} className="w-full py-3.5 bg-spa-elevated border border-white/5 text-spa-crema rounded-xl text-[9px] font-bold uppercase tracking-widest hover:border-spa-gold transition-all flex items-center justify-center gap-2">
                                  🔍 Consultar / Cancelar / Reagendar
                              </button>
                              <button onClick={() => setBotStep("massages")} className="w-full py-3.5 bg-spa-elevated border border-white/5 text-spa-crema rounded-xl text-[9px] font-bold uppercase tracking-widest hover:border-spa-gold transition-all flex items-center justify-center gap-2">
                                  ✨ Cejas y Precios
                              </button>
                              <button onClick={() => setBotStep("info")} className="w-full py-3.5 bg-spa-elevated border border-white/5 text-spa-crema rounded-xl text-[9px] font-bold uppercase tracking-widest hover:border-spa-gold transition-all flex items-center justify-center gap-2">
                                  📍 Ubicación y Horarios
                              </button>
                              <button onClick={() => setBotStep("faq")} className="w-full py-3.5 bg-spa-elevated border border-white/5 text-spa-crema rounded-xl text-[9px] font-bold uppercase tracking-widest hover:border-spa-gold transition-all flex items-center justify-center gap-2">
                                  💬 Preguntas Frecuentes (FAQ)
                              </button>
                              <button onClick={() => setBotStep("contact")} className="w-full py-3.5 bg-spa-elevated border border-white/5 text-spa-crema rounded-xl text-[9px] font-bold uppercase tracking-widest hover:border-spa-gold transition-all flex items-center justify-center gap-2">
                                  📞 Hablar con JP Brow Studio
                              </button>
                          </div>
                      )}

                      {botStep === "massages" && (
                          <div className="space-y-4">
                              <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1 no-scrollbar">
                                  {(config.massageTypes || []).map((m: any) => (
                                      <div key={m.id || m.name} className="bg-spa-elevated p-4 rounded-2xl border border-white/5 space-y-2 text-left">
                                          <div className="flex justify-between items-start gap-2">
                                              <p className="text-xs font-bold text-spa-crema">{m.name}</p>
                                              <span className="text-xs font-serif text-spa-gold font-bold shrink-0">{m.price}</span>
                                          </div>
                                          <p className="text-[10px] text-[#7A7D7B] leading-relaxed">{m.description}</p>
                                          <div className="flex justify-between items-center pt-1 text-[8px] text-spa-gold/70">
                                              <span>⏱ Duración: {m.duration}</span>
                                              {m.intensity && <span>⚡ Intensidad: {getIntensityInfo(m.intensity).label}</span>}
                                          </div>
                                          <button 
                                              onClick={() => {
                                                  setShowBot(false);
                                                  toast.success(`Has seleccionado: ${m.name}. Elige una hora disponible en el calendario.`);
                                              }} 
                                              className="w-full mt-2 py-2 bg-spa-accent/10 border border-spa-accent/30 rounded-xl text-[9px] font-bold uppercase tracking-widest text-spa-gold hover:bg-spa-accent hover:text-spa-base transition-all cursor-pointer"
                                          >
                                              Reservar este servicio
                                          </button>
                                      </div>
                                  ))}
                              </div>
                              <button onClick={() => setBotStep("greeting")} className="w-full py-3 bg-white/5 rounded-xl text-[9px] font-bold uppercase tracking-widest text-[#7A7D7B] hover:text-spa-crema transition-all cursor-pointer">← Volver al Menú</button>
                          </div>
                      )}

                      {botStep === "info" && (
                          <div className="space-y-4">
                              <div className="bg-spa-elevated p-5 rounded-2xl border border-white/5 space-y-4 text-left">
                                  <div>
                                      <p className="text-[9px] text-[#7A7D7B] font-bold uppercase mb-1">📍 Dirección del Estudio</p>
                                      <p className="text-xs text-spa-crema leading-relaxed">{config.address || "Dirección por definir"}</p>
                                      {config.address && (
                                          <a 
                                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(config.address)}`} 
                                              target="_blank" 
                                              rel="noreferrer"
                                              className="inline-block mt-2 text-[9px] font-bold uppercase text-[#3B82F6] hover:underline"
                                          >
                                              📌 Ver en Google Maps →
                                          </a>
                                      )}
                                  </div>
                                  <div className="border-t border-white/5 pt-3">
                                      <p className="text-[9px] text-[#7A7D7B] font-bold uppercase mb-1.5">⏰ Horarios de Apertura</p>
                                      <p className="text-[10px] text-spa-crema leading-relaxed">
                                          Nuestros turnos disponibles para reservas son:
                                      </p>
                                      <ul className="text-[9px] text-[#A0A3A1] space-y-1 mt-1.5 list-disc pl-4">
                                          <li><strong>Turno Mañana:</strong> {config.morningHours?.length > 0 ? `${config.morningHours[0]} a ${config.morningHours[config.morningHours.length - 1]}` : "9:00 a 14:00"}</li>
                                          <li><strong>Turno Tarde:</strong> {config.afternoonHours?.length > 0 ? `${config.afternoonHours[0]} a ${config.afternoonHours[config.afternoonHours.length - 1]}` : "15:00 a 21:00"}</li>
                                      </ul>
                                  </div>
                              </div>
                              <button onClick={() => setBotStep("greeting")} className="w-full py-3 bg-white/5 rounded-xl text-[9px] font-bold uppercase tracking-widest text-[#7A7D7B] hover:text-spa-crema transition-all cursor-pointer">← Volver al Menú</button>
                          </div>
                      )}

                      {botStep === "faq" && (
                          <div className="space-y-4">
                              <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1 no-scrollbar text-left">
                                  <div className="bg-spa-elevated p-4 rounded-2xl border border-white/5 space-y-1">
                                      <p className="text-xs font-bold text-spa-gold">¿Con cuánto tiempo de antelación debo llegar?</p>
                                      <p className="text-[10px] text-[#A0A3A1] leading-relaxed">Recomendamos llegar unos 5 o 10 minutos antes de la hora acordada para poder prepararte con total tranquilidad y disfrutar de la experiencia al completo.</p>
                                  </div>
                                  <div className="bg-spa-elevated p-4 rounded-2xl border border-white/5 space-y-1">
                                      <p className="text-xs font-bold text-spa-gold">¿Cuál es la política de cancelación?</p>
                                      <p className="text-[10px] text-[#A0A3A1] leading-relaxed">Puedes cancelar o reagendar tu cita sin ningún coste adicional hasta 24 horas antes del comienzo de la sesión. Se puede hacer directamente desde la web.</p>
                                  </div>
                                  <div className="bg-spa-elevated p-4 rounded-2xl border border-white/5 space-y-1">
                                      <p className="text-xs font-bold text-spa-gold">¿Qué formas de pago tenéis?</p>
                                      <p className="text-[10px] text-[#A0A3A1] leading-relaxed">Aceptamos únicamente pagos en efectivo en el estudio una vez finalizado el servicio.</p>
                                  </div>
                              </div>
                              <button onClick={() => setBotStep("greeting")} className="w-full py-3 bg-white/5 rounded-xl text-[9px] font-bold uppercase tracking-widest text-[#7A7D7B] hover:text-spa-crema transition-all cursor-pointer">← Volver al Menú</button>
                          </div>
                      )}

                      {botStep === "contact" && (
                          <div className="space-y-4">
                              <div className="bg-spa-elevated p-5 rounded-2xl border border-white/5 space-y-4 text-center">
                                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-500/10 flex items-center justify-center text-emerald-400 mx-auto border border-emerald-500/20">
                                      <Send size={20} />
                                  </div>
                                  <div className="space-y-1">
                                      <p className="text-sm font-serif text-spa-crema">Atención Directa por WhatsApp</p>
                                      <p className="text-[10px] text-[#7A7D7B]">¿Tienes dudas especiales o prefieres agendar de forma manual? Contacta directamente por WhatsApp.</p>
                                  </div>
                                  <a 
                                      href={`https://wa.me/${config.phone || "34623101111"}?text=Hola,%20tengo%20una%20consulta%20sobre%20los%20servicios%20de%20cejas.`} 
                                      target="_blank" 
                                      rel="noreferrer"
                                      className="inline-flex items-center justify-center gap-2 w-full py-4 bg-emerald-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500 transition-all shadow-lg cursor-pointer text-decoration-none"
                                  >
                                      💬 Abrir chat de WhatsApp
                                  </a>
                                  <p className="text-[8px] text-[#7A7D7B] mt-1">
                                      Correo: jpbrowstudio@gmail.com
                                  </p>
                              </div>
                              <button onClick={() => setBotStep("greeting")} className="w-full py-3 bg-white/5 rounded-xl text-[9px] font-bold uppercase tracking-widest text-[#7A7D7B] hover:text-spa-crema transition-all cursor-pointer">← Volver al Menú</button>
                          </div>
                      )}

                      {botStep === "ask_email" && (
                          <div className="space-y-4">
                              <p className="text-[10px] text-spa-gold font-bold uppercase tracking-widest px-2">Introduce tu Email</p>
                              <div className="relative">
                                  <input 
                                      type="email" autoFocus
                                      id="bot-email-input"
                                      className="w-full h-14 bg-spa-elevated border border-white/5 rounded-2xl px-5 pr-14 outline-none focus:border-spa-gold transition-all text-sm"
                                      placeholder="ejemplo@correo.com"
                                      onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                              const val = (e.target as HTMLInputElement).value;
                                              if (val) {
                                                  setBotData({...botData, email: val});
                                                  setBotStep("ask_verification");
                                              }
                                          }
                                      }}
                                  />
                                  <button 
                                      onClick={() => {
                                          const el = document.getElementById("bot-email-input") as HTMLInputElement;
                                          if (el.value) {
                                              setBotData({...botData, email: el.value});
                                              setBotStep("ask_verification");
                                          }
                                      }}
                                      className="absolute right-2 top-2 w-10 h-10 bg-spa-accent rounded-xl flex items-center justify-center text-spa-crema hover:bg-spa-gold transition-all cursor-pointer"
                                  >
                                      <Send size={16} />
                                  </button>
                              </div>
                              <button onClick={() => setBotStep("greeting")} className="text-[9px] text-[#7A7D7B] uppercase font-bold hover:text-spa-crema px-2 cursor-pointer">← Volver</button>
                          </div>
                      )}

                      {botStep === "ask_verification" && (
                          <div className="space-y-4">
                              <p className="text-[10px] text-spa-gold font-bold uppercase tracking-widest px-2">Verificación (Nombre o Teléfono)</p>
                              <div className="relative">
                                  <input 
                                      type="text" autoFocus
                                      id="bot-verify-input"
                                      className="w-full h-14 bg-spa-elevated border border-white/5 rounded-2xl px-5 pr-14 outline-none focus:border-spa-gold transition-all text-sm"
                                      placeholder="Tu nombre o teléfono..."
                                      onKeyDown={async (e) => {
                                          if (e.key === "Enter") {
                                              handleBotVerify((e.target as HTMLInputElement).value);
                                          }
                                      }}
                                  />
                                  <button 
                                      onClick={() => {
                                          const el = document.getElementById("bot-verify-input") as HTMLInputElement;
                                          handleBotVerify(el.value);
                                      }}
                                      className="absolute right-2 top-2 w-10 h-10 bg-spa-accent rounded-xl flex items-center justify-center text-spa-crema hover:bg-spa-gold transition-all cursor-pointer"
                                  >
                                      <Send size={16} />
                                  </button>
                              </div>
                              <button onClick={() => setBotStep("ask_email")} className="text-[9px] text-[#7A7D7B] uppercase font-bold hover:text-spa-crema px-2 cursor-pointer">← Cambiar Email</button>
                          </div>
                      )}

                      {botStep === "show_appointments" && (
                          <div className="space-y-4">
                              <p className="text-[10px] text-spa-gold font-bold uppercase tracking-widest px-2">Tus Próximas Citas</p>
                              {botData.appts.map(a => (
                                  <div key={a.id} className="bg-spa-elevated p-5 rounded-2xl border border-white/5 space-y-4">
                                      <div className="flex justify-between items-start">
                                          <div>
                                              <p className="text-xs font-serif text-spa-crema">{format(parseISO(a.startTime), "EEEE d 'de' MMMM", { locale: es })}</p>
                                              <p className="text-[10px] text-spa-gold font-bold uppercase tracking-widest mt-1">{format(parseISO(a.startTime), "HH:mm")}</p>
                                          </div>
                                          <div className="px-2 py-1 bg-spa-accent/10 border border-spa-accent/20 rounded-md text-[8px] font-bold text-spa-gold uppercase tracking-tighter">Confirmada</div>
                                      </div>
                                      <div className="flex gap-2 pt-2">
                                          <button onClick={() => { setBotData({...botData, selectedApptId: a.id!}); setBotStep("reschedule"); toast.info("Selecciona un nuevo horario disponible en el calendario"); }} className="flex-1 py-3 bg-spa-accent/10 border border-spa-accent/30 rounded-xl text-[9px] font-bold uppercase tracking-widest text-spa-gold hover:bg-spa-accent hover:text-spa-base transition-all cursor-pointer">Reagendar</button>
                                          <button onClick={() => {
                                               setCancelModalData({ appt: a, mode: "client_cancel" });
                                           }} className="px-4 py-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-[9px] font-bold uppercase tracking-widest text-rose-500 hover:bg-rose-500 hover:text-white transition-all cursor-pointer"><Trash2 size={14}/></button>
                                      </div>
                                  </div>
                              ))}
                              <button onClick={() => setBotStep("greeting")} className="w-full py-3 bg-white/5 rounded-xl text-[9px] font-bold uppercase tracking-widest text-[#7A7D7B] hover:text-spa-crema transition-all cursor-pointer">Finalizar</button>
                          </div>
                      )}
                  </div>
                </motion.div>
              )}

              {/* Premium Bottom Docked Rescheduling Bar (Replaces overlay during reschedule step for zero-friction mobile UX) */}
              {botStep === "reschedule" && (
                <motion.div 
                  initial={{ opacity: 0, y: 100 }} 
                  animate={{ opacity: 1, y: 0 }} 
                  exit={{ opacity: 0, y: 100 }} 
                  className="fixed bottom-0 left-0 right-0 w-full bg-spa-card/95 backdrop-blur-xl border-t border-white/10 p-6 z-50 flex flex-col md:flex-row items-center justify-between gap-4 shadow-[0_-10px_30px_rgba(0,0,0,0.6)]"
                >
                  <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="w-12 h-12 rounded-2xl bg-spa-accent/20 border border-spa-accent/40 flex items-center justify-center text-spa-gold shrink-0">
                      <CalendarIcon size={22} />
                    </div>
                    <div className="text-left">
                      <h4 className="text-xs font-bold text-spa-gold uppercase tracking-[0.2em] mb-0.5">Reagendando tu cita</h4>
                      {botRescheduleSlot ? (
                        <p className="text-sm text-spa-crema font-medium font-serif">
                          Nuevo horario: <strong className="text-spa-gold">{format(botRescheduleSlot, "EEEE d 'de' MMMM, HH:mm", { locale: es })}</strong>
                        </p>
                      ) : (
                        <p className="text-xs text-[#7A7D7B]">
                          Pulsa una hora disponible en el calendario para seleccionarla.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full md:w-auto justify-end">
                    <button 
                      onClick={() => {
                        setBotStep("show_appointments");
                        setBotRescheduleSlot(null);
                      }} 
                      className="px-5 py-3 rounded-xl border border-white/10 text-[9px] font-bold uppercase tracking-widest text-[#7A7D7B] hover:text-spa-crema hover:border-white/20 transition-all cursor-pointer"
                    >
                      Atrás
                    </button>
                    {botRescheduleSlot && (
                      <button 
                        onClick={async () => {
                          try {
                            await fetch(`/api/bot/appointments/${botData.selectedApptId}/reschedule`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ newStartTime: botRescheduleSlot.toISOString() })
                            });
                            toast.success("Cita reprogramada con éxito");
                            fetchAppointments();
                            setBotStep("greeting");
                            setShowBot(false);
                            setBotRescheduleSlot(null);
                          } catch {
                            toast.error("Error al reprogramar cita");
                          }
                        }} 
                        className="px-6 py-3 bg-spa-gold text-spa-base rounded-xl text-[9px] font-bold uppercase tracking-widest hover:bg-spa-gold/80 transition-all font-semibold shadow-lg shadow-spa-gold/10 cursor-pointer"
                      >
                        Confirmar Cambio
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </>
          )}

          {/* Side Menu */}
          {showSideMenu && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSideMenu(false)} className="absolute inset-0 z-[60] bg-black/30" />
              <motion.div
                initial={{ opacity: 0, y: 30, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 30, scale: 0.9 }}
                transition={{ type: "spring", damping: 25, stiffness: 350 }}
                className="absolute bottom-24 inset-x-0 z-[70] flex justify-center px-8"
              >
                <div className="w-full max-w-[280px] bg-spa-card rounded-[24px] border border-white/10 shadow-2xl p-6 flex flex-col items-center gap-5">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-spa-gold to-spa-accent flex items-center justify-center text-spa-base shadow-lg">
                      <Leaf size={22} />
                    </div>
                    <span className="text-[8px] font-bold text-spa-gold uppercase tracking-[0.3em]">JP Brows</span>
                  </div>
                  <div className="w-full space-y-2">
                    <button onClick={() => { setShowSideMenu(false); setShowBot(true); }} className="w-full flex items-center gap-3 p-3.5 bg-spa-elevated rounded-xl border border-white/5 hover:border-spa-gold/30 hover:bg-spa-accent/10 transition-all group">
                      <div className="w-9 h-9 rounded-lg bg-spa-accent/10 flex items-center justify-center text-spa-gold group-hover:bg-spa-gold group-hover:text-spa-base transition-all shrink-0"><CalendarIcon size={16}/></div>
                      <span className="text-sm font-medium">Gestionar Cita</span>
                    </button>
                    <button onClick={() => { setShowSideMenu(false); setShowServices(true); }} className="w-full flex items-center gap-3 p-3.5 bg-spa-elevated rounded-xl border border-white/5 hover:border-spa-gold/30 hover:bg-spa-accent/10 transition-all group">
                      <div className="w-9 h-9 rounded-lg bg-spa-accent/10 flex items-center justify-center text-spa-gold group-hover:bg-spa-gold group-hover:text-spa-base transition-all shrink-0"><Leaf size={16}/></div>
                      <span className="text-sm font-medium">Servicios</span>
                    </button>
                    {isAdminAuth ? (
                      <>
                      <button onClick={() => { setShowSideMenu(false); setShowClientsPage(true); }} className="w-full flex items-center gap-3 p-3.5 bg-spa-elevated rounded-xl border border-white/5 hover:border-spa-gold/30 hover:bg-spa-accent/10 transition-all group">
                        <div className="w-9 h-9 rounded-lg bg-spa-accent/10 flex items-center justify-center text-spa-gold group-hover:bg-spa-gold group-hover:text-spa-base transition-all shrink-0"><CalendarIcon size={16}/></div>
                        <span className="text-sm font-medium">Clientes y Citas</span>
                      </button>
                      <button onClick={() => { setShowSideMenu(false); setShowAdminPanel(true); }} className="w-full flex items-center gap-3 p-3.5 bg-spa-elevated rounded-xl border border-white/5 hover:border-spa-gold/30 hover:bg-spa-accent/10 transition-all group">
                        <div className="w-9 h-9 rounded-lg bg-spa-gold flex items-center justify-center text-spa-base shrink-0"><User size={16}/></div>
                        <span className="text-sm font-medium">Administración</span>
                      </button>
                      </>
                    ) : (
                      <a href="/api/auth/google" className="w-full flex items-center gap-3 p-3.5 bg-spa-elevated rounded-xl border border-white/5 hover:border-spa-gold/30 hover:bg-spa-accent/10 transition-all group">
                        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-spa-crema group-hover:bg-spa-gold group-hover:text-spa-base transition-all shrink-0"><User size={16}/></div>
                        <span className="text-sm font-medium">Acceso Admin</span>
                      </a>
                    )}
                  </div>
                  {isAdminAuth && (
                    <button onClick={handleLogout} className="flex items-center gap-2 text-rose-500 text-[10px] font-bold uppercase tracking-widest hover:text-rose-400 transition-all">
                      <LogOut size={12}/> Cerrar Sesión
                    </button>
                  )}
                </div>
              </motion.div>
            </>
          )}
         </AnimatePresence>
      </div>
    </div>
    </ErrorBoundary>
  );
}
