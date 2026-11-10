/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Mic, 
  MicOff, 
  Save, 
  ChevronRight, 
  ChevronLeft,
  Truck,
  List,
  BarChart3,
  PlusCircle,
  CheckCircle2,
  User,
  Package,
  TrendingUp,
  Scale,
  DollarSign,
  Calculator,
  Tag,
  Filter,
  Minus,
  X,
  Cloud,
  Search,
  Users,
  Settings,
  Download,
  Trash2,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signOut } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  getDoc,
  getDocFromServer,
  writeBatch
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// --- Firebase Init ---
/**
 * لمستخدمي هذا التطبيق: لربط التطبيق بحسابك الخاص في فاير بيز (Firebase):
 * 1. قم بإنشاء مشروع في Firebase Console.
 * 2. أضف تطبيق Web واحصل على بيانات الإعداد (Firebase Config).
 * 3. قم بتعديل ملف firebase-applet-config.json في مجلد المشروع ووضع بيانات مشروعك هناك.
 */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth();

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
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

// --- Types ---
interface ShipmentEntry {
  id: string;
  name: string;      // اسم النقلة
  category: string;  // الصنف
  count: number;     // العدد
  premium: number;   // البياعة
  weight: number;    // الوزن
  price: number;     // السعر
  totalWithPremium: number; // الاجمالي بالبياعة
  totalWithoutPremium: number; // الاجمالي بدون بياعة (سعر في وزن فقط)
  entryUser: string; // المستخدم الذي سجل العملية
  date: string;      // تاريخ العملية
  timestamp: number;
  status: 'pending' | 'approved';
  isModified?: boolean;
  customerName: string; // اسم الزبون
}

interface UserProfile {
  id: string;
  name: string;
  role: 'admin' | 'editor' | 'readonly' | 'password_manager';
  password: string;
}

const DEFAULT_USERS: UserProfile[] = [
  { id: '1', name: 'حسن', role: 'admin', password: '123' },
  { id: '2', name: 'سيد', role: 'editor', password: '123' },
  { id: '5', name: 'محمد', role: 'editor', password: '123' },
  { id: '3', name: 'عمر', role: 'readonly', password: '123' },
  { id: '4', name: 'يوزر ادمن', role: 'password_manager', password: '123' }
];

// --- Voice Recognition Hook ---
const useSpeechToText = (onResult: (text: string) => void, isEnabled: boolean) => {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (!isEnabled) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'ar-SA';

      recognitionRef.current.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        onResult(text);
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, [onResult, isEnabled]);

  const toggleListening = () => {
    if (!isEnabled) return;
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  return { isListening, toggleListening };
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'input' | 'records' | 'reports' | 'smart' | 'security' | 'sent_records'>('input');
  const [currentStep, setCurrentStep] = useState(1);
  const [entries, setEntries] = useState<ShipmentEntry[]>([]);
  const [users, setUsers] = useState<UserProfile[]>(DEFAULT_USERS);
  const [smartText, setSmartText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile>(DEFAULT_USERS[0]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Auth & Security States
  const [loginSelectedUser, setLoginSelectedUser] = useState<UserProfile | null>(null);
  const [passwordInput, setPasswordPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [searchAllDates, setSearchAllDates] = useState(false);

  // Editing State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<ShipmentEntry>>({});

  // Quick Select Suggestions
  const [suggestedNames, setSuggestedNames] = useState<string[]>([]);
  const [suggestedCategories, setSuggestedCategories] = useState<string[]>([]);

  // Real-time Data Fetching
  useEffect(() => {
    // 0. Sign in anonymously to satisfy security rules
    signInAnonymously(auth).catch(err => console.error("Auth error:", err));

    // 1. Sync Users
    const unsubscribeUsers = onSnapshot(collection(db, 'users'), async (snapshot) => {
      if (snapshot.empty) {
        // Bootstrap initial users if DB is empty
        for (const u of DEFAULT_USERS) {
          await setDoc(doc(db, 'users', u.id), u);
        }
      } else {
        const usersList = snapshot.docs.map(doc => doc.data() as UserProfile);
        setUsers(usersList);
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'users'));

    // 2. Sync Shipments
    const unsubscribeShipments = onSnapshot(collection(db, 'shipments'), (snapshot) => {
      const shipmentList = snapshot.docs.map(doc => doc.data() as ShipmentEntry);
      setEntries(shipmentList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'shipments'));

    // 3. Sync Suggestions (limited to last 10)
    const unsubscribeNames = onSnapshot(collection(db, 'suggestions_names'), (snapshot) => {
      const names = snapshot.docs.map(doc => doc.data().value as string);
      setSuggestedNames(names.slice(0, 10));
    });
    const unsubscribeCats = onSnapshot(collection(db, 'suggestions_categories'), (snapshot) => {
      const cats = snapshot.docs.map(doc => doc.data().value as string);
      setSuggestedCategories(cats.slice(0, 10));
    });

    return () => {
      unsubscribeUsers();
      unsubscribeShipments();
      unsubscribeNames();
      unsubscribeCats();
    };
  }, []);

  // Auth Persistence
  useEffect(() => {
    const savedUserId = localStorage.getItem('nakla_current_user_id');
    if (savedUserId) {
      const foundUser = users.find(u => u.id === savedUserId);
      if (foundUser) {
        setCurrentUser(foundUser);
        setIsLoggedIn(true);
        if (foundUser.role === 'password_manager') setActiveTab('security');
      }
    }
  }, [users]);

  const handleLoginAttempt = () => {
    if (!loginSelectedUser) return;
    if (passwordInput === loginSelectedUser.password) {
      setCurrentUser(loginSelectedUser);
      setIsLoggedIn(true);
      if (loginSelectedUser.role === 'password_manager') {
        setActiveTab('security');
      } else {
        setActiveTab('input');
      }
      localStorage.setItem('nakla_current_user_id', loginSelectedUser.id);
      setPasswordPasswordInput('');
      setLoginSelectedUser(null);
    } else {
      alert('كلمة المرور غير صحيحة');
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    localStorage.removeItem('nakla_current_user_id');
  };

  const handlePasswordChangeInLogin = async () => {
    if (!loginSelectedUser || !newPasswordInput.trim()) return;
    
    try {
      await updateDoc(doc(db, 'users', loginSelectedUser.id), { password: newPasswordInput });
      alert('تم تحديث كلمة المرور بنجاح. يمكنك الدخول الآن.');
      setNewPasswordInput('');
      setIsChangingPassword(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${loginSelectedUser.id}`);
    }
  };

  const handleClearDatabase = async () => {
    if (currentUser.role !== 'admin') {
      alert('عذراً، هذه الصلاحية للمدير فقط');
      return;
    }

    const pass = window.prompt('يرجى إدخال كلمة مرور المدير (حسن) لإتمام المسح:');
    if (pass === currentUser.password) {
      if (window.confirm('تحذير: هل أنت متأكد من مسح كافة السجلات من قاعدة البيانات نهائياً؟')) {
        try {
          const batch = writeBatch(db);
          entries.forEach(e => {
            batch.delete(doc(db, 'shipments', e.id));
          });
          await batch.commit();
          alert('تم تفريغ قاعدة البيانات بنجاح');
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'shipments');
        }
      }
    } else {
      alert('كلمة المرور غير صحيحة. تم إلغاء العملية.');
    }
  };

  const handleExportExcel = () => {
    if (entries.length === 0) {
      alert('لا توجد بيانات لتصديرها');
      return;
    }

    const headers = [
      'التاريخ', 
      'المستخدم', 
      'اسم النقلة', 
      'الصنف', 
      'الزبون',
      'العدد', 
      'البياعة', 
      'الوزن', 
      'السعر', 
      'الإجمالي بالبياعة (ج.م)', 
      'الإجمالي بدون بياعة (ج.م)'
    ];
    
    const data = entries.map(e => [
      e.date,
      users.find(u => u.id === e.entryUser)?.name || e.entryUser,
      e.name,
      e.category,
      e.customerName || 'غير محدد',
      e.count,
      e.premium,
      e.weight,
      e.price,
      e.totalWithPremium,
      e.totalWithoutPremium
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
    
    // Set column widths for better visibility
    const wscols = [
      { wch: 12 }, // Date
      { wch: 15 }, // User
      { wch: 20 }, // Name
      { wch: 15 }, // Category
      { wch: 15 }, // Customer
      { wch: 10 }, // Count
      { wch: 10 }, // Premium
      { wch: 10 }, // Weight
      { wch: 10 }, // Price
      { wch: 20 }, // Total With
      { wch: 20 }, // Total Without
    ];
    worksheet['!cols'] = wscols;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "تقرير النقلات");
    
    // Support for RTL in Excel if needed
    if (!workbook.Workbook) workbook.Workbook = {};
    if (!workbook.Workbook.Views) workbook.Workbook.Views = [];
    if (!workbook.Workbook.Views[0]) workbook.Workbook.Views[0] = {};
    (workbook.Workbook.Views[0] as any).rtl = true;

    XLSX.writeFile(workbook, `Nakla_Pro_Report_${selectedDate}.xlsx`);
  };
  
  // Wizard Form State
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    count: 0,
    premium: 0,
    weight: 0,
    price: 0,
    customerName: ''
  });

  const steps = [
    { id: 1, label: 'اسم النقلة', field: 'name', icon: <User className="w-8 h-8" />, placeholder: 'مثال: أحمد جابر' },
    { id: 2, label: 'الصنف', field: 'category', icon: <Tag className="w-8 h-8" />, placeholder: 'مثال: كاكا لوكس' },
    { id: 3, label: 'العدد', field: 'count', icon: <Package className="w-8 h-8" />, placeholder: 'مثال: 150' },
    { id: 4, label: 'البياعة', field: 'premium', icon: <TrendingUp className="w-8 h-8" />, placeholder: 'مثال: 5.5' },
    { id: 5, label: 'الوزن', field: 'weight', icon: <Scale className="w-8 h-8" />, placeholder: 'مثال: 1200' },
    { id: 6, label: 'السعر', field: 'price', icon: <DollarSign className="w-8 h-8" />, placeholder: 'مثال: 22.5' },
    { id: 7, label: 'اسم الزبون', field: 'customerName', icon: <Users className="w-8 h-8" />, placeholder: 'مثال: محل الأمانة' }
  ];

  const handleVoiceResult = useCallback((text: string) => {
    if (currentUser.role === 'readonly') return;
    if (activeTab === 'smart') {
      setSmartText(text.trim());
      return;
    }
    const currentField = steps[currentStep - 1].field as keyof typeof formData;
    const value = text.trim();

    if (currentField === 'name' || currentField === 'category') {
      setFormData(prev => ({ ...prev, [currentField]: value }));
    } else {
      const num = parseFloat(value.replace(/[^0-9.]/g, ''));
      if (!isNaN(num)) {
        setFormData(prev => ({ ...prev, [currentField]: num }));
      }
    }
  }, [currentStep, activeTab, currentUser]);

  const { isListening, toggleListening: baseToggleListening } = useSpeechToText(handleVoiceResult, currentUser.role !== 'readonly');

  const toggleListening = () => {
    if (currentUser.role === 'readonly') {
      alert('لا تملك صلاحية الإدخال (عرض فقط)');
      return;
    }
    if (!isListening) {
      if (activeTab === 'smart') {
        setSmartText('');
      } else {
        const currentField = steps[currentStep - 1].field as keyof typeof formData;
        setFormData(prev => ({ 
          ...prev, 
          [currentField]: (currentField === 'name' || currentField === 'category') ? '' : 0 
        }));
      }
    }
    baseToggleListening();
  };

  const handleNext = async () => {
    if (currentUser.role === 'readonly') return;
    if (currentStep < 7) {
      if (currentStep === 1 && formData.name) {
        await setDoc(doc(db, 'suggestions_names', formData.name), { value: formData.name, timestamp: Date.now() });
      }
      if (currentStep === 2 && formData.category) {
        await setDoc(doc(db, 'suggestions_categories', formData.category), { value: formData.category, timestamp: Date.now() });
      }
      setCurrentStep(prev => prev + 1);
    } else {
      const weight = Number(formData.weight);
      const price = Number(formData.price);
      const count = Number(formData.count);
      const premium = Number(formData.premium);

      try {
        const existing = entries.find(e => e.name === formData.name && e.category === formData.category && e.date === selectedDate);
        const shipmentId = existing ? existing.id : Math.random().toString(36).substr(2, 9);
        
        const shipmentData: ShipmentEntry = {
          id: shipmentId,
          ...formData,
          totalWithPremium: (weight * price) + (count * premium),
          totalWithoutPremium: weight * price,
          entryUser: currentUser.id,
          date: selectedDate,
          timestamp: Date.now(),
          status: 'pending',
          customerName: formData.customerName || 'غير محدد'
        };

        await setDoc(doc(db, 'shipments', shipmentId), shipmentData);
        
        if (formData.name) await setDoc(doc(db, 'suggestions_names', formData.name), { value: formData.name, timestamp: Date.now() });
        if (formData.category) await setDoc(doc(db, 'suggestions_categories', formData.category), { value: formData.category, timestamp: Date.now() });

        setFormData({ name: '', category: '', count: 0, premium: 0, weight: 0, price: 0, customerName: '' });
        setCurrentStep(1);
        setActiveTab('records');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'shipments');
      }
    }
  };

  const handleSmartParse = async () => {
    if (currentUser.role === 'readonly') return;
    if (!smartText.trim()) return;
    setIsParsing(true);
    try {
      const response = await fetch('/api/parse-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: smartText })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      const existing = entries.find(e => e.name === data.name && e.category === data.category && e.date === selectedDate);
      const shipmentId = existing ? existing.id : Math.random().toString(36).substr(2, 9);

      const shipmentData: ShipmentEntry = {
        id: shipmentId,
        ...data,
        totalWithPremium: (data.weight * data.price) + (data.count * data.premium),
        totalWithoutPremium: data.weight * data.price,
        entryUser: currentUser.id,
        date: selectedDate,
        timestamp: Date.now(),
        status: 'pending',
        customerName: data.customerName || 'غير محدد'
      };

      await setDoc(doc(db, 'shipments', shipmentId), shipmentData);
      
      if (data.name) await setDoc(doc(db, 'suggestions_names', data.name), { value: data.name, timestamp: Date.now() });
      if (data.category) await setDoc(doc(db, 'suggestions_categories', data.category), { value: data.category, timestamp: Date.now() });

      setSmartText('');
      setActiveTab('records');
    } catch (error) {
      alert('فشل في تحليل النص. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleEditStart = (entry: ShipmentEntry) => {
    if (currentUser.role === 'readonly') return;
    setEditingId(entry.id);
    setEditFormData({ ...entry });
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    try {
      const updated = { ...editFormData };
      updated.totalWithPremium = (Number(updated.weight) * Number(updated.price)) + (Number(updated.count) * Number(updated.premium));
      updated.totalWithoutPremium = Number(updated.weight) * Number(updated.price);
      updated.status = 'pending';
      updated.isModified = true;

      await updateDoc(doc(db, 'shipments', editingId), updated);
      setEditingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `shipments/${editingId}`);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await updateDoc(doc(db, 'shipments', id), { status: 'approved' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `shipments/${id}`);
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditFormData({});
  };

  const handleDelete = async (id: string) => {
    if (currentUser.role !== 'admin') {
      alert('عذراً، هذه الصلاحية للمدير فقط');
      return;
    }
    if (window.confirm('هل أنت متأكد من حذف هذا السجل؟')) {
      try {
        await deleteDoc(doc(db, 'shipments', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `shipments/${id}`);
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep(prev => prev - 1);
  };

  // --- Data Processing for Records ---
  const filteredSortedEntries = useMemo(() => {
    return entries
      .filter(e => {
        const dateMatch = searchAllDates ? true : e.date === selectedDate;
        const searchMatch = customerSearch ? (e.customerName || '').includes(customerSearch) : true;
        return dateMatch && searchMatch;
      })
      .sort((a, b) => {
        if (a.name !== b.name) return a.name.localeCompare(b.name, 'ar');
        return a.category.localeCompare(b.category, 'ar');
      });
  }, [entries, selectedDate, customerSearch, searchAllDates]);

  const pendingEntries = useMemo(() => {
    return entries
      .filter(e => e.status === 'pending')
      .sort((a, b) => {
        if (a.name !== b.name) return a.name.localeCompare(b.name, 'ar');
        return a.category.localeCompare(b.category, 'ar');
      });
  }, [entries]);

  // --- Data Processing for Reports ---
  const groupedReports = useMemo(() => {
    const dailyEntries = entries.filter(e => {
      const dateMatch = searchAllDates ? true : e.date === selectedDate;
      const statusMatch = e.status === 'approved';
      const searchMatch = customerSearch ? (e.customerName || '').includes(customerSearch) : true;
      return dateMatch && statusMatch && searchMatch;
    });
    const groups: Record<string, {
      name: string;
      category: string;
      totalWithPremium: number;
      totalWithoutPremium: number;
      totalWeight: number;
      totalUnits: number;
      count: number;
    }> = {};

    dailyEntries.forEach(e => {
      const key = `${e.name}_${e.category}`;
      if (!groups[key]) {
        groups[key] = {
          name: e.name,
          category: e.category,
          totalWithPremium: 0,
          totalWithoutPremium: 0,
          totalWeight: 0,
          totalUnits: 0,
          count: 0
        };
      }
      groups[key].totalWithPremium += e.totalWithPremium;
      groups[key].totalWithoutPremium += e.totalWithoutPremium;
      groups[key].totalWeight += Number(e.weight);
      groups[key].totalUnits += Number(e.count);
      groups[key].count += 1;
    });

    return Object.values(groups);
  }, [entries, selectedDate]);

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0F1020] text-white font-sans flex flex-col items-center justify-center p-6" dir="rtl">
        <div className="w-full max-w-md bg-[#1A1B35] rounded-[2.5rem] border border-white/5 p-10 shadow-2xl flex flex-col items-center">
           <div className="bg-[#6366F1] p-5 rounded-[2rem] mb-8 shadow-2xl shadow-indigo-500/20">
             <Truck className="w-12 h-12 text-white" />
           </div>
           
           {!loginSelectedUser ? (
             <>
               <h1 className="text-2xl font-black mb-2 tracking-tight">نـقـلـة بـرو</h1>
               <p className="text-slate-500 text-xs font-bold uppercase tracking-[0.2em] mb-10">اختر حسابك للدخول</p>
               <div className="w-full space-y-4">
                 {users.map(user => (
                   <button
                     key={user.id}
                     onClick={() => setLoginSelectedUser(user)}
                     className="w-full group flex items-center justify-between p-5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl transition-all duration-300 active:scale-95"
                   >
                     <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                          <User size={20} className={user.role === 'admin' ? 'text-emerald-400' : 'text-slate-300'} />
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-sm group-hover:text-white transition-colors">{user.name}</p>
                          <p className="text-[10px] text-slate-500 group-hover:text-white/60 transition-colors">
                            {user.role === 'admin' ? 'مدير النظام' : user.role === 'editor' ? 'مدخل بيانات' : user.role === 'password_manager' ? 'مسؤول الأمان' : 'مراقب'}
                          </p>
                        </div>
                     </div>
                     <ChevronLeft className="w-5 h-5 text-slate-700 group-hover:text-white transition-all group-hover:-translate-x-1" />
                   </button>
                 ))}
               </div>
             </>
           ) : (
             <div className="w-full flex flex-col items-center animate-fade-in">
               <h2 className="text-xl font-bold mb-2">{loginSelectedUser.name}</h2>
               <p className="text-slate-500 text-[10px] font-bold uppercase mb-8 tracking-widest text-center">يرجى إدخال كلمة المرور</p>
               
               <input 
                 autoFocus
                 type="password"
                 value={passwordInput}
                 onChange={(e) => setPasswordPasswordInput(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && handleLoginAttempt()}
                 className="w-full bg-[#0F1020] border-2 border-white/10 rounded-2xl px-6 py-4 text-center text-xl tracking-[0.5em] focus:border-[#6366F1] outline-none transition-all mb-6"
                 placeholder="••••"
               />
               
               <button 
                 onClick={handleLoginAttempt}
                 className="w-full bg-[#6366F1] py-4 rounded-2xl font-black text-lg shadow-xl shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all mb-4"
               >
                 دخول للنظام
               </button>
               
               <button 
                 onClick={() => { setLoginSelectedUser(null); setPasswordPasswordInput(''); }}
                 className="text-slate-500 font-bold text-xs hover:text-white transition-colors"
               >
                 العودة لقائمة المستخدمين
               </button>
             </div>
           )}
           
           <p className="mt-12 text-[10px] text-slate-700 font-black uppercase tracking-widest">
             V2.7-STABLE // AUTH_REQUIRED
           </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F1020] text-white font-sans flex flex-col items-center p-4 md:p-8" dir="rtl">
      
      {/* Responsive Header Bar */}
      <header className="w-full max-w-6xl flex items-center justify-between mb-4 md:mb-10 px-2 md:px-6 gap-2">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="bg-[#6366F1] p-2 md:p-3 rounded-xl md:rounded-2xl shadow-lg shadow-indigo-500/20">
            <Truck className="w-4 h-4 md:w-6 md:h-6 text-white" />
          </div>
          <div className="block">
            <h1 className="text-sm md:text-xl font-black tracking-tight">نـقـلـة بـرو</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 md:gap-4">
          {/* Admin Tools Dropdown */}
          {currentUser.role === 'admin' && (
            <div className="relative">
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-xl border transition-all ${showSettings ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-[#1A1B35] text-slate-400 border-white/5 hover:border-white/10'}`}
                title="الإعدادات"
              >
                <Settings size={18} />
              </button>

              <AnimatePresence>
                {showSettings && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute top-full left-0 mt-2 w-48 bg-[#1A1B35] border border-white/10 rounded-2xl shadow-2xl z-50 p-2 space-y-1"
                  >
                    <button 
                      onClick={() => { handleExportExcel(); setShowSettings(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-xl text-xs font-bold text-slate-300 hover:text-emerald-400 transition-all text-right"
                    >
                      <Download size={14} />
                      تصدير (Excel / XLSX)
                    </button>
                    <div className="h-px bg-white/5 mx-2" />
                    <button 
                      onClick={() => { handleClearDatabase(); setShowSettings(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/10 rounded-xl text-xs font-bold text-red-500 transition-all text-right"
                    >
                      <Trash2 size={14} />
                      تفريغ قاعدة البيانات
                    </button>
                    <div className="px-4 py-2 text-[8px] font-bold text-slate-600 border-t border-white/5 mt-1">
                      إجمالي السجلات السحابية: {entries.length}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* User Info & Logout */}
          <div className="bg-[#1A1B35] px-2 md:px-4 py-1 md:py-2 rounded-lg md:rounded-xl border border-white/5 flex items-center gap-2 text-emerald-500">
             <Cloud size={14} className="animate-pulse" />
             <span className="text-[9px] font-black uppercase hidden sm:inline">مزامنة سحابية نشطة</span>
          </div>

          <div className="flex items-center gap-2 md:gap-3 bg-[#1A1B35] rounded-lg md:rounded-xl border border-white/5 pl-1 pr-2 md:pl-2 md:pr-4 py-1">
             <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white/5 flex items-center justify-center text-[10px] font-bold text-indigo-400">
               {currentUser.id}
             </div>
             <div className="hidden sm:block text-right">
                <p className="text-[10px] font-black leading-none">{currentUser.name}</p>
                <p className="text-[8px] text-slate-500 font-bold uppercase">{currentUser.role === 'admin' ? 'مدير' : currentUser.role === 'password_manager' ? 'أمان' : 'مدخل'}</p>
             </div>
             <button 
               onClick={handleLogout}
               className="mr-2 p-1.5 hover:bg-white/5 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
               title="خروج"
             >
               <Minus size={14} />
             </button>
          </div>

          {/* Date Selector */}
          <div className="flex items-center bg-[#1A1B35] rounded-lg md:rounded-xl border border-white/5 overflow-hidden">
            <input 
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent border-none text-[10px] md:text-xs font-black text-slate-300 focus:ring-0 px-2 md:px-3 py-1 md:py-2 outline-none color-scheme-dark max-w-[90px] md:max-w-none"
            />
          </div>

          <div className="bg-[#1A1B35] px-2 md:px-4 py-1 md:py-2 rounded-lg md:rounded-xl border border-white/5 text-[9px] md:text-[10px] font-black text-slate-500 md:text-emerald-500 tabular-nums">
             {entries.length} <span className="hidden md:inline">سجلات</span><span className="md:hidden">س</span>
          </div>
        </div>
      </header>

      {/* Responsive Navigation Tabs */}
      <div className="w-full max-w-4xl bg-[#1A1B35]/50 p-1 md:p-1.5 rounded-xl md:rounded-2xl mb-8 md:mb-16 flex items-center gap-1 md:gap-2 border border-white/5">
        {[
          { id: 'input', label: 'إدخال', shortLabel: 'سريع', icon: <Mic className="w-3 h-3 md:w-4 md:h-4" />, gradient: 'from-[#4F46E5] to-[#7C3AED]', roles: ['admin', 'editor'] },
          { id: 'smart', label: 'إدخال ذكي', shortLabel: 'ذكي', icon: <Calculator className="w-3 h-3 md:w-4 md:h-4" />, gradient: 'from-[#10B981] to-[#059669]', roles: ['admin', 'editor'] },
          { id: 'sent_records', label: 'سجلات مرسلة', shortLabel: 'مرسل', icon: <Save className="w-3 h-3 md:w-4 md:h-4" />, gradient: 'from-amber-400 to-orange-500', roles: ['readonly'] },
          { id: 'records', label: 'السجلات', shortLabel: 'سجل', icon: <List className="w-3 h-3 md:w-4 md:h-4" />, gradient: '', roles: ['admin', 'editor', 'readonly'] },
          { id: 'reports', label: 'التقارير', shortLabel: 'تقرير', icon: <BarChart3 className="w-3 h-3 md:w-4 md:h-4" />, gradient: '', roles: ['admin', 'editor', 'readonly'] }
        ].filter(tab => !tab.roles || tab.roles.includes(currentUser.role)).map(tab => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 py-2 md:py-3 rounded-lg md:rounded-xl font-black text-[9px] md:text-sm transition-all duration-300 ${activeTab === tab.id ? `bg-gradient-to-r ${tab.gradient || 'bg-white/10'} text-white shadow-xl scale-[1.02]` : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.shortLabel}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'smart' && (
          <motion.div 
            key="smart-input"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-4xl flex flex-col items-center"
          >
            <div className="w-full bg-[#1A1B35] rounded-[2.5rem] border border-white/5 p-8 md:p-16 flex flex-col items-center shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-50" />
               
               <button 
                 onClick={() => setActiveTab('input')}
                 className="absolute top-6 right-6 p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-full transition-all"
                 title="إغلاق"
               >
                 <X size={20} />
               </button>
               
               <div className="w-24 h-24 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center mb-8 shadow-2xl shadow-emerald-500/40">
                 <Calculator className="w-10 h-10 text-white" />
               </div>

               <h2 className="text-3xl font-black mb-2 text-white text-center">إدخال نصي كامل (AI)</h2>
               <p className="text-slate-500 text-sm font-bold mb-8 text-center max-w-lg">
                 تحدث أو اكتب جملة كاملة تحتوي على كافة التفاصيل. وسيقوم النظام باستخراجها آلياً.
               </p>

               {/* Guide / Example Section */}
               <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-2xl p-4 mb-8">
                 <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                   <PlusCircle className="w-3 h-3" />
                   أمثلة لطريقة الإملاء المقترحة
                 </p>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-[#0F1020] p-3 rounded-xl border border-white/5">
                      <p className="text-[10px] text-slate-500 mb-1">مثال 1 (ترتيب طبيعي)</p>
                      <p className="text-xs font-bold text-slate-300">"نقلة أحمد جابر صنف كاكا لوكس عدد 100 بياعة 5 وزن 1200 بسعر 22"</p>
                    </div>
                    <div className="bg-[#0F1020] p-3 rounded-xl border border-white/5">
                      <p className="text-[10px] text-slate-500 mb-1">مثال 2 (مختصر - فاكهة)</p>
                      <p className="text-xs font-bold text-slate-300">"إبراهيم هلال، مانجو عويس، 50 قفص، بياعة 10، وزن 500، سعر 100"</p>
                    </div>
                 </div>
                 <div className="mt-4 flex items-center justify-between px-2 opacity-50">
                    {[
                      { l: 'الاسم', c: 'text-indigo-400' },
                      { l: 'الصنف', c: 'text-blue-400' },
                      { l: 'العدد', c: 'text-purple-400' },
                      { l: 'البياعة', c: 'text-pink-400' },
                      { l: 'الوزن', c: 'text-emerald-400' },
                      { l: 'السعر', c: 'text-amber-400' }
                    ].map((step, i) => (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <span className={`text-[9px] font-black ${step.c}`}>{step.l}</span>
                        <div className="w-1 h-1 rounded-full bg-current" />
                      </div>
                    ))}
                 </div>
               </div>

               <div className="w-full max-w-2xl relative mb-12">
                 <textarea 
                   value={smartText}
                   onChange={(e) => setSmartText(e.target.value)}
                   className="w-full h-40 bg-[#0F1020]/80 border border-white/10 rounded-3xl p-6 text-xl font-bold text-white focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-xl resize-none placeholder:text-slate-700"
                   placeholder="مثال: سجل نقلة لأحمد جابر صنف كاكا لوكس عدد 150 بياعة 5 وزن 1200 بسعر 25..."
                 />
                 <button 
                   onClick={toggleListening}
                   className={`absolute bottom-6 left-6 w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-[#1A1B35] text-slate-400 hover:text-white border border-white/5'}`}
                 >
                   {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                 </button>
               </div>

               <button 
                 onClick={handleSmartParse}
                 disabled={isParsing || !smartText.trim()}
                 className="w-full max-w-2xl bg-gradient-to-r from-emerald-500 to-teal-600 py-5 rounded-2xl font-black text-lg text-white shadow-xl shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group"
               >
                 {isParsing ? (
                   <div className="flex items-center gap-3">
                     <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                     جاري التحليل واستخراج البيانات...
                   </div>
                 ) : (
                   <>
                     استخراج وحفظ البيانات
                     <ChevronLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
                   </>
                 )}
               </button>
            </div>
          </motion.div>
        )}

        {activeTab === 'input' && (
          <motion.div 
            key="input-wizard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-4xl flex flex-col items-center"
          >
            {/* Step Progress Circles */}
            <div className="flex items-center gap-4 mb-16 relative">
               <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/5 -translate-y-1/2 -z-10" />
               {[7, 6, 5, 4, 3, 2, 1].map(num => (
                 <div 
                   key={num}
                   className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-all duration-500 ${currentStep >= num ? 'bg-[#3B82F6] border-[#3B82F6] text-white shadow-lg shadow-blue-500/40' : 'bg-[#1A1B35] border-white/10 text-slate-600'}`}
                 >
                   {num}
                 </div>
               ))}
            </div>

            {/* Input Card */}
            <div className="w-full bg-[#1A1B35] rounded-[2.5rem] border border-white/5 p-8 md:p-16 flex flex-col items-center shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#3B82F6] to-transparent opacity-50" />
               
               {/* Step Icon */}
               <div className="w-24 h-24 bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] rounded-full flex items-center justify-center mb-8 shadow-2xl shadow-indigo-500/40">
                 <div className="text-white">
                   {steps[currentStep - 1].icon}
                 </div>
               </div>

               {/* Step Label */}
               <h2 className="text-3xl font-black mb-2 text-white">{steps[currentStep - 1].label}</h2>
               <p className="text-slate-500 text-sm font-bold mb-12">{steps[currentStep - 1].placeholder}</p>

               {/* Voice Input Box */}
               <div className="w-full max-w-2xl relative group mb-6">
                 <div className="absolute inset-0 bg-[#3B82F6]/5 rounded-3xl blur-xl group-focus-within:bg-[#3B82F6]/10 transition-all" />
                 <div className="relative bg-[#0F1020]/80 border border-white/10 rounded-3xl p-4 flex items-center gap-4 focus-within:border-[#3B82F6]/50 transition-all shadow-xl">
                    <button 
                      onClick={toggleListening}
                      className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-[#1A1B35] text-slate-400 hover:text-white'}`}
                    >
                      {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                    </button>
                    <input 
                      autoFocus
                      type={(steps[currentStep-1].field === 'name' || steps[currentStep-1].field === 'category') ? 'text' : 'number'}
                      value={formData[steps[currentStep-1].field as keyof typeof formData] || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, [steps[currentStep-1].field]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                      className="flex-1 bg-transparent border-none text-2xl font-black text-white focus:ring-0 text-center md:text-right px-4 placeholder:text-white/5"
                      placeholder={steps[currentStep-1].placeholder}
                    />
                 </div>
               </div>

               {/* Quick Select Suggestions */}
               {(currentStep === 1 || currentStep === 2) && (
                 <div className="w-full max-w-2xl flex flex-wrap justify-center gap-2 mb-12">
                   {(currentStep === 1 ? suggestedNames : suggestedCategories).map((item, idx) => (
                     <button
                       key={idx}
                       onClick={() => setFormData(prev => ({ ...prev, [steps[currentStep-1].field]: item }))}
                       className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all active:scale-95"
                     >
                       {item}
                     </button>
                   ))}
                   {(currentStep === 1 ? suggestedNames : suggestedCategories).length === 0 && (
                     <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">لا توجد اختصارات بعد</p>
                   )}
                 </div>
               )}

               {/* Navigation Buttons */}
               <div className="w-full max-w-2xl flex flex-col gap-4 mt-6">
                 <button 
                   onClick={handleNext}
                   className="w-full bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] py-5 rounded-2xl font-black text-lg text-white shadow-xl shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 group"
                 >
                   {currentStep === 6 ? 'إتمام وحفظ النقلة' : 'التالي'}
                   <ChevronLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
                 </button>
                 
                 {currentStep > 1 && (
                   <button 
                     onClick={handleBack}
                     className="w-full py-4 text-slate-500 font-bold hover:text-white transition-colors"
                   >
                     رجوع للسابق
                   </button>
                 )}
               </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'sent_records' && (
          <motion.div 
            key="sent-records-list"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="w-full max-w-6xl"
          >
            <div className="bg-[#1A1B35] rounded-[2rem] border border-white/5 overflow-hidden shadow-2xl relative">
               <button 
                 onClick={() => setActiveTab('input')}
                 className="absolute top-6 right-6 p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-full transition-all z-20"
                 title="إغلاق"
               >
                 <X size={18} />
               </button>
               <div className="p-8 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between bg-[#1A1B35] gap-4">
                  <div>
                    <h3 className="text-xl font-bold mb-1">سجلات مرسلة (للمراجعة والتسجيل)</h3>
                    <p className="text-[10px] text-amber-500 font-bold uppercase tracking-widest">بانتظار موافقة عمر</p>
                  </div>
                  
                  {/* Customer Search Bar */}
                  <div className="flex flex-col md:flex-row items-center gap-3 max-w-md w-full">
                    <div className="relative flex-1">
                      <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                      <input 
                        type="text"
                        placeholder="بحث بأسم الزبون..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        className="w-full bg-[#0F1020] border border-white/5 rounded-xl pr-12 pl-4 py-2 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap bg-white/5 px-3 py-2 rounded-xl border border-white/5 hover:bg-white/10 transition-all">
                      <input 
                        type="checkbox" 
                        checked={searchAllDates} 
                        onChange={(e) => setSearchAllDates(e.target.checked)}
                        className="w-4 h-4 rounded border-white/10 bg-[#0F1020] text-indigo-500 focus:ring-0 focus:ring-offset-0"
                      />
                      <span className="text-[10px] font-bold text-slate-400">كل المبيعات</span>
                    </label>
                  </div>
               </div>
               <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-right border-collapse min-w-[700px] md:min-w-full">
                    <thead>
                      <tr className="bg-[#0F1020]/50 text-[9px] md:text-xs font-black text-slate-500 uppercase tracking-widest border-b border-white/5">
                        <th className="p-3 md:p-6">التاريخ</th>
                        <th className="p-3 md:p-6">المستخدم</th>
                        <th className="p-3 md:p-6">النقلة</th>
                        <th className="p-3 md:p-6">صنف</th>
                        <th className="p-3 md:p-6">الزبون</th>
                        <th className="p-3 md:p-6 text-center">العدد</th>
                        <th className="p-3 md:p-6 text-center">الوزن</th>
                        <th className="p-3 md:p-6 text-left">إجمالي</th>
                        <th className="p-3 md:p-6 w-32">الحالة</th>
                        <th className="p-3 md:p-6 text-center">الإجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {pendingEntries.map(entry => (
                        <tr key={entry.id} className="hover:bg-white/5 transition-colors group">
                          <td className="p-3 md:p-6 text-[10px] text-slate-500 font-bold tabular-nums">{entry.date}</td>
                          <td className="p-3 md:p-6 text-[10px] text-indigo-400 font-bold">{users.find(u => u.id === entry.entryUser)?.name || entry.entryUser}</td>
                          <td className="p-3 md:p-6 font-bold text-white text-xs md:text-sm">{entry.name}</td>
                          <td className="p-3 md:p-6 text-xs text-indigo-300 font-bold">{entry.category}</td>
                          <td className="p-3 md:p-6 text-xs text-slate-400 font-bold">{entry.customerName}</td>
                          <td className="p-3 md:p-6 text-center text-xs font-bold text-purple-400 tabular-nums">{entry.count}</td>
                          <td className="p-3 md:p-6 text-center text-xs font-bold text-indigo-400 tabular-nums">{entry.weight}</td>
                          <td className="p-3 md:p-6 text-left font-black text-emerald-500 tabular-nums text-xs md:text-lg">{entry.totalWithPremium.toLocaleString()}</td>
                          <td className="p-3 md:p-6">
                            {entry.isModified ? (
                              <div className="flex flex-col items-start gap-1">
                                <span className="px-3 py-1 bg-orange-500 text-white text-[10px] font-black rounded-lg shadow-sm">معدلة</span>
                                <span className="text-[8px] text-slate-500 font-bold">تغيير في البيانات</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-start gap-1">
                                <span className="px-3 py-1 bg-blue-600 text-white text-[10px] font-black rounded-lg shadow-sm">جديدة</span>
                                <span className="text-[8px] text-slate-500 font-bold">تسجيل أول مرة</span>
                              </div>
                            )}
                          </td>
                          <td className="p-3 md:p-6 text-center">
                             <button 
                               onClick={() => handleApprove(entry.id)}
                               className={`w-full max-w-[120px] py-2.5 rounded-xl text-[10px] font-black shadow-lg transition-all active:scale-95 ${
                                 entry.isModified 
                                   ? 'bg-orange-500 hover:bg-orange-400 text-white shadow-orange-500/20' 
                                   : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20'
                               }`}
                             >
                               {entry.isModified ? 'تم التعديل' : 'تم التسجيل'}
                             </button>
                          </td>
                        </tr>
                      ))}
                      {pendingEntries.length === 0 && (
                        <tr><td colSpan={9} className="p-12 text-center text-[10px] text-slate-500 font-bold italic">لا توجد سجلات بانتظار المراجعة</td></tr>
                      )}
                    </tbody>
                  </table>
               </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'records' && (
          <motion.div 
            key="records-list"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="w-full max-w-6xl"
          >
            <div className="bg-[#1A1B35] rounded-[2rem] border border-white/5 overflow-hidden shadow-2xl relative">
               <button 
                 onClick={() => setActiveTab('input')}
                 className="absolute top-6 right-6 p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-full transition-all z-20"
                 title="إغلاق"
               >
                 <X size={18} />
               </button>
               <div className="p-8 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between bg-[#1A1B35] gap-4">
                  <div>
                    <h3 className="text-xl font-bold mb-1">سجل العمليات (مرتب بالنقلة والصنف)</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">إجمالي {entries.length} سجلات مرتبة</p>
                  </div>
                  
                  {/* Customer Search Bar */}
                  <div className="flex flex-col md:flex-row items-center gap-3 max-w-md w-full">
                    <div className="relative flex-1">
                      <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                      <input 
                        type="text"
                        placeholder="بحث بأسم الزبون..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        className="w-full bg-[#0F1020] border border-white/5 rounded-xl pr-12 pl-4 py-2 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap bg-white/5 px-3 py-2 rounded-xl border border-white/5 hover:bg-white/10 transition-all">
                      <input 
                        type="checkbox" 
                        checked={searchAllDates} 
                        onChange={(e) => setSearchAllDates(e.target.checked)}
                        className="w-4 h-4 rounded border-white/10 bg-[#0F1020] text-indigo-500 focus:ring-0 focus:ring-offset-0"
                      />
                      <span className="text-[10px] font-bold text-slate-400">كل المبيعات</span>
                    </label>
                  </div>
               </div>
               <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-right border-collapse min-w-[700px] md:min-w-full">
                    <thead>
                      <tr className="bg-[#0F1020]/50 text-[9px] md:text-xs font-black text-slate-500 uppercase tracking-tighter md:tracking-widest border-b border-white/5">
                        <th className="p-3 md:p-6 w-20 md:w-32">التاريخ</th>
                        <th className="p-3 md:p-6 w-12 md:w-20 text-center">
                          <span className="md:hidden">م</span><span className="hidden md:inline">المستخدم</span>
                        </th>
                        <th className="p-3 md:p-6">النقلة</th>
                        <th className="p-3 md:p-6">صنف</th>
                        <th className="p-3 md:p-6">الزبون</th>
                        <th className="p-3 md:p-6 text-center">
                          <span className="md:hidden">#</span><span className="hidden md:inline">العدد</span>
                        </th>
                        <th className="p-3 md:p-6 text-center">
                          <span className="md:hidden">ب</span><span className="hidden md:inline">بياعة</span>
                        </th>
                        <th className="p-3 md:p-6 text-center">
                          <span className="md:hidden">و</span><span className="hidden md:inline">الوزن</span>
                        </th>
                        <th className="p-3 md:p-6 text-center">
                          <span className="md:hidden">س</span><span className="hidden md:inline">سعر</span>
                        </th>
                        <th className="p-3 md:p-6 text-left">إجمالي</th>
                        <th className="p-3 md:p-6 w-20 md:w-32"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredSortedEntries.map(entry => (
                        <tr key={entry.id} className={`hover:bg-white/5 transition-colors group ${editingId === entry.id ? 'bg-indigo-500/10' : ''}`}>
                          <td className="p-3 md:p-6 text-[9px] md:text-xs text-slate-500 font-bold tabular-nums">
                            <span className="md:hidden">{entry.date.split('-').slice(1).join('/')}</span>
                            <span className="hidden md:inline">{entry.date}</span>
                          </td>
                          <td className="p-3 md:p-6 text-[10px] md:text-xs text-indigo-400 font-bold text-center">
                            {entry.entryUser}
                          </td>
                          <td className="p-2 md:p-4">
                            {editingId === entry.id ? (
                              <input 
                                className="bg-[#1A1B35] border border-white/10 rounded px-2 py-1 text-xs md:text-sm font-bold w-full"
                                value={editFormData.name || ''}
                                onChange={e => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                              />
                            ) : (
                              <div className="font-bold text-white text-xs md:text-sm truncate max-w-[80px] md:max-w-none">{entry.name}</div>
                            )}
                          </td>
                          <td className="p-2 md:p-4">
                            {editingId === entry.id ? (
                              <input 
                                className="bg-[#1A1B35] border border-white/10 rounded px-2 py-1 text-xs md:text-sm font-bold w-full"
                                value={editFormData.category || ''}
                                onChange={e => setEditFormData(prev => ({ ...prev, category: e.target.value }))}
                              />
                            ) : (
                              <div className="text-[10px] md:text-sm text-indigo-300 font-bold truncate max-w-[60px] md:max-w-none">{entry.category}</div>
                            )}
                          </td>
                          <td className="p-2 md:p-4 text-xs text-slate-400 font-bold truncate max-w-[60px] md:max-w-none">
                            {entry.customerName}
                          </td>
                          <td className="p-2 md:p-4 text-center">
                            {editingId === entry.id ? (
                              <input 
                                type="number"
                                className="bg-[#1A1B35] border border-white/10 rounded px-1 py-1 text-xs font-bold w-12 md:w-20 text-center"
                                value={editFormData.count || 0}
                                onChange={e => setEditFormData(prev => ({ ...prev, count: Number(e.target.value) }))}
                              />
                            ) : (
                              <div className="text-[10px] md:text-sm font-bold text-purple-400 tabular-nums">{entry.count}</div>
                            )}
                          </td>
                          <td className="p-2 md:p-4 text-center">
                            {editingId === entry.id ? (
                              <input 
                                type="number"
                                className="bg-[#1A1B35] border border-white/10 rounded px-1 py-1 text-xs font-bold w-12 md:w-20 text-center"
                                value={editFormData.premium || 0}
                                onChange={e => setEditFormData(prev => ({ ...prev, premium: Number(e.target.value) }))}
                              />
                            ) : (
                              <div className="text-[10px] md:text-sm font-bold text-purple-300 tabular-nums">{entry.premium}</div>
                            )}
                          </td>
                          <td className="p-2 md:p-4 text-center">
                            {editingId === entry.id ? (
                              <input 
                                type="number"
                                className="bg-[#1A1B35] border border-white/10 rounded px-1 py-1 text-xs font-bold w-16 md:w-24 text-center"
                                value={editFormData.weight || 0}
                                onChange={e => setEditFormData(prev => ({ ...prev, weight: Number(e.target.value) }))}
                              />
                            ) : (
                              <div className="text-[10px] md:text-sm font-bold text-indigo-400 tabular-nums">{entry.weight}</div>
                            )}
                          </td>
                          <td className="p-2 md:p-4 text-center">
                            {editingId === entry.id ? (
                              <input 
                                type="number"
                                className="bg-[#1A1B35] border border-white/10 rounded px-1 py-1 text-xs font-bold w-12 md:w-20 text-center"
                                value={editFormData.price || 0}
                                onChange={e => setEditFormData(prev => ({ ...prev, price: Number(e.target.value) }))}
                              />
                            ) : (
                              <div className="text-[10px] md:text-sm font-bold text-indigo-300 tabular-nums">{entry.price}</div>
                            )}
                          </td>
                          <td className="p-3 md:p-6 text-left">
                            <div className="font-black text-emerald-500 tabular-nums text-xs md:text-lg">
                              {(editingId === entry.id ? ((Number(editFormData.weight) * Number(editFormData.price)) + (Number(editFormData.count) * Number(editFormData.premium))) : entry.totalWithPremium).toLocaleString()}
                            </div>
                            {entry.status === 'pending' && (
                              <div className="text-[8px] font-bold text-amber-500 mt-1">بانتظار التسجيل</div>
                            )}
                          </td>
                          <td className="p-2 md:p-4">
                             <div className="flex gap-1 md:gap-2">
                               {editingId === entry.id ? (
                                 <button onClick={handleEditSave} className="bg-emerald-600 p-1.5 rounded-lg hover:bg-emerald-500 transition-colors"><Save size={14} /></button>
                               ) : (
                                 currentUser.role !== 'readonly' && (
                                   <>
                                     <button onClick={() => handleEditStart(entry)} className="text-slate-600 hover:text-white p-1.5"><TrendingUp size={14} /></button>
                                     {currentUser.role === 'admin' && (
                                       <button onClick={() => handleDelete(entry.id)} className="text-slate-600 hover:text-red-400 p-1.5"><Trash2 size={14} /></button>
                                     )}
                                   </>
                                 )
                               )}
                             </div>
                          </td>
                        </tr>
                      ))}
                     {filteredSortedEntries.length === 0 && (
                       <tr><td colSpan={10} className="p-12 text-center text-[10px] text-slate-500 font-bold italic">لا توجد سجلات لهذا التاريخ</td></tr>
                     )}
                   </tbody>
                 </table>
               </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'reports' && (
          <motion.div 
            key="reports-dash"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-6xl space-y-8"
          >
             {/* Summary Cards */}
             <div className="grid md:grid-cols-2 gap-6">
               <div className="bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] p-8 rounded-[2rem] shadow-xl text-white">
                  <Calculator className="w-8 h-8 mb-4 opacity-50" />
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-1">الإجمالي الشامل اليومي (بالبياعة)</p>
                  <h4 className="text-3xl font-black tabular-nums">
                    {groupedReports.reduce((acc, curr) => acc + curr.totalWithPremium, 0).toLocaleString()} ج.م
                  </h4>
               </div>
               <div className="bg-[#1A1B35] border border-white/5 p-8 rounded-[2rem] shadow-xl text-white">
                  <DollarSign className="w-8 h-8 mb-4 text-emerald-500 opacity-50" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">إجمالي المبيعات اليومية (وزن × سعر)</p>
                  <h4 className="text-3xl font-black tabular-nums">
                    {groupedReports.reduce((acc, curr) => acc + curr.totalWithoutPremium, 0).toLocaleString()} ج.م
                  </h4>
               </div>
             </div>

             {/* Detailed Grouped Report */}
             <div className="bg-[#1A1B35] rounded-[2rem] border border-white/5 overflow-hidden shadow-2xl relative">
                <button 
                  onClick={() => setActiveTab('input')}
                  className="absolute top-4 right-4 p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-full transition-all z-20"
                  title="إغلاق"
                >
                  <X size={18} />
                </button>

                <div className="p-8 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between bg-[#1A1B35] gap-4">
                   <div>
                     <h3 className="text-sm font-bold">تقرير مجمع</h3>
                     <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">نتائج اليوم حسب الصنف</p>
                   </div>

                   {/* Customer Search Bar */}
                   <div className="flex flex-col md:flex-row items-center gap-3 max-w-md w-full">
                     <div className="relative flex-1">
                       <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                       <input 
                         type="text"
                         placeholder="بحث بأسم الزبون..."
                         value={customerSearch}
                         onChange={(e) => setCustomerSearch(e.target.value)}
                         className="w-full bg-[#0F1020] border border-white/5 rounded-xl pr-12 pl-4 py-2 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                       />
                     </div>
                     <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap bg-white/5 px-3 py-2 rounded-xl border border-white/5 hover:bg-white/10 transition-all">
                       <input 
                         type="checkbox" 
                         checked={searchAllDates} 
                         onChange={(e) => setSearchAllDates(e.target.checked)}
                         className="w-4 h-4 rounded border-white/10 bg-[#0F1020] text-indigo-500 focus:ring-0 focus:ring-offset-0"
                       />
                       <span className="text-[10px] font-bold text-slate-400">كل المبيعات</span>
                     </label>
                   </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse min-w-[500px]">
                    <thead>
                      <tr className="bg-[#0F1020]/50 text-[9px] font-black text-slate-500 uppercase tracking-tighter border-b border-white/5">
                         <th className="p-3">نقلة / صنف</th>
                         <th className="p-3 text-center"># كلي</th>
                         <th className="p-3 text-center">و كلي</th>
                         <th className="p-3 text-center">متوسط</th>
                         <th className="p-3 text-center text-purple-400">إ ب</th>
                         <th className="p-3 text-left text-emerald-400">إ ص</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {groupedReports.map((report, idx) => (
                        <tr key={idx} className="hover:bg-white/5 transition-colors group">
                          <td className="p-3">
                            <div className="font-bold text-white text-xs">{report.name}</div>
                            <div className="text-[9px] text-slate-500 font-bold">{report.category}</div>
                          </td>
                          <td className="p-3 text-center tabular-nums font-bold text-purple-400 text-xs">{report.totalUnits}</td>
                          <td className="p-3 text-center tabular-nums font-bold text-slate-300 text-xs">{report.totalWeight}</td>
                          <td className="p-3 text-center tabular-nums font-bold text-indigo-400 text-xs">
                            {report.totalWeight > 0 ? (report.totalWithoutPremium / report.totalWeight).toFixed(1) : '0'}
                          </td>
                          <td className="p-3 text-center tabular-nums font-black text-purple-400 text-xs">{report.totalWithPremium.toLocaleString()}</td>
                          <td className="p-3 text-left tabular-nums font-black text-emerald-500 text-xs">{report.totalWithoutPremium.toLocaleString()}</td>
                        </tr>
                      ))}
                      {groupedReports.length === 0 && (
                        <tr><td colSpan={6} className="p-12 text-center text-[10px] text-slate-500 font-bold italic">لا توجد بيانات للتقارير</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
             </div>
          </motion.div>
        )}

        {activeTab === 'security' && currentUser.role === 'password_manager' && (
          <motion.div 
            key="security-view"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-4xl flex flex-col items-center"
          >
            <div className="w-full bg-[#1A1B35] rounded-[2.5rem] border border-white/5 p-8 md:p-12 flex flex-col items-center shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent opacity-50" />
               
               <button 
                 onClick={handleLogout}
                 className="absolute top-6 right-6 p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-full transition-all"
                 title="إغلاق"
               >
                 <X size={20} />
               </button>
               
               <div className="w-20 h-20 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center mb-6 shadow-2xl shadow-amber-500/40">
                 <Lock className="w-10 h-10 text-white" />
               </div>

               <h2 className="text-2xl font-black mb-2 text-white">سجلات الأمان</h2>
               <p className="text-slate-500 text-xs font-bold mb-8 text-center">
                 استعراض كلمات مرور المستخدمين الحالية.
               </p>

               <div className="w-full overflow-hidden bg-white/5 rounded-2xl border border-white/10">
                 <table className="w-full text-right border-collapse">
                   <thead>
                     <tr className="bg-white/5 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5">
                       <th className="p-4">المستخدم</th>
                       <th className="p-4">الدور</th>
                       <th className="p-4">كلمة المرور</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5">
                     {users.map(u => (
                       <tr key={u.id} className="hover:bg-white/5 transition-colors">
                         <td className="p-4 text-xs font-bold text-white">{u.name}</td>
                         <td className="p-4 text-[10px] font-bold text-slate-500">
                           {u.role === 'admin' ? 'مدير' : u.role === 'editor' ? 'مدخل' : u.role === 'password_manager' ? 'أمان' : 'مراقب'}
                         </td>
                         <td className="p-4 text-sm font-black text-amber-500 tabular-nums tracking-widest">
                           {u.password}
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
               
               <div className="mt-8 p-4 bg-white/5 rounded-xl border border-white/10 w-full">
                 <p className="text-[9px] text-slate-500 text-center font-bold">
                   تذكر: كلمة المرور الافتراضية هي <span className="text-amber-500">123</span>.
                 </p>
               </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Status */}
      <footer className="mt-auto pt-12 text-[9px] text-slate-700 font-black uppercase tracking-[0.3em] flex items-center gap-8">
        <div className="flex items-center gap-2">
          <div className="w-1 h-1 rounded-full bg-emerald-500" />
          <span>MDI_CORE_ACTIVE</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1 h-1 rounded-full bg-indigo-500" />
          <span>ARABIC_SPEECH_READY</span>
        </div>
        <div className="opacity-40">{new Date().toLocaleTimeString('ar-EG')}</div>
      </footer>
    </div>
  );
}
