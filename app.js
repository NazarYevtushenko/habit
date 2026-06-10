import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
    getAuth,
    GoogleAuthProvider,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
    getFirestore,
    collection,
    doc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    getDoc,
    onSnapshot,
    query,
    orderBy,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const LEGACY_STORAGE_KEYS = ["habit-main-local-v2", "habit-main-local-v1"];
const LOCAL_SETTINGS_KEY = "habit-main-settings-v1";

const firebaseConfig = {
  apiKey: "AIzaSyADGhBYM07ZPTC_yYjaAXzdowJNuO_z2bw",
  authDomain: "habit-4dfbc.firebaseapp.com",
  projectId: "habit-4dfbc",
  storageBucket: "habit-4dfbc.firebasestorage.app",
  messagingSenderId: "1055332478071",
  appId: "1:1055332478071:web:a593820d8ca27bcec82a72",
  measurementId: "G-KDP68B7X31"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const COLORS = ["teal", "violet", "green", "amber", "rose", "blue"];
const ICONS = ["◉", "✦", "◆", "✚", "☾", "▣", "✓", "∞", "☆", "☼"];
const WEEKDAYS = [
    { label: "Пн", value: 1 },
    { label: "Вт", value: 2 },
    { label: "Ср", value: 3 },
    { label: "Чт", value: 4 },
    { label: "Пт", value: 5 },
    { label: "Сб", value: 6 },
    { label: "Вс", value: 0 }
];
const DEFAULT_HABITS = [
    { name: "Зарядка для ума", icon: "✦", color: "teal" },
    { name: "Книга на английском языке", icon: "☆", color: "green" },
    { name: "Ведение дневника", icon: "✓", color: "rose" },
];

const COINS_PER_HABIT = 10;
const COINS_PER_WATER = 5;
const WATER_GOAL_GLASSES = 4;

const SHOP_ITEMS = [
    { id: "audiobook", name: "15 мин аудиокниги", icon: "🎧", cost: 50 },
    { id: "instagram", name: "15 мин Инстаграм", icon: "📱", cost: 40 },
    { id: "mcdonalds", name: "Бургер из Макдака", icon: "🍔", cost: 300 },
    { id: "chips", name: "Чипсы", icon: "🍟", cost: 120 },
    { id: "youtube", name: "Видео YouTube", icon: "▶", cost: 30 },
];

const DEFAULT_ACTIVITIES = [
    { id: "pushups", name: "25 отжиманий", icon: "✦", coins: 20 },
    { id: "walk", name: "Прогулка 25 мин", icon: "☼", coins: 20 },
];

class HabitModel {
    constructor() {
        this.user = null;
        this.habits = [];
        this.settings = loadLocalSettings();
        this.habitListeners = [];
        this.settingsListeners = [];
        this.unsubscribeHabits = null;
        this.unsubscribeSettings = null;
        this.gamification = { coins: 0, awardedHabits: {}, bonusActivities: {} };
        this.gamificationListeners = [];
        this.unsubscribeGamification = null;
    }

    onAuth(callback) {
        return onAuthStateChanged(auth, async (user) => {
            this.user = user;
            if (user) {
                try {
                    await this.startUserSession(user);
                } catch (error) {
                    console.error("Ошибка при работе с БД:", error);
                }
            } else {
                this.stopUserSession();
            }
            callback(user);
        });
    }

    async register(email, password) {
        return createUserWithEmailAndPassword(auth, email, password);
    }

    async login(email, password) {
        return signInWithEmailAndPassword(auth, email, password);
    }

    async loginWithGoogle() {
        return signInWithPopup(auth, googleProvider);
    }

    async logout() {
        return signOut(auth);
    }

    async startUserSession(user) {
        await this.ensureUserSeeded(user.uid);
        this.listenHabits(user.uid);
        this.subscribeToSettings(user.uid);
        this.subscribeToGamification(user.uid);
    }

    stopUserSession() {
        if (this.unsubscribeHabits) this.unsubscribeHabits();
        if (this.unsubscribeSettings) this.unsubscribeSettings();
        if (this.unsubscribeGamification) this.unsubscribeGamification();
        this.unsubscribeHabits = null;
        this.unsubscribeSettings = null;
        this.unsubscribeGamification = null;
        this.habits = [];
        this.gamification = { coins: 0, awardedHabits: {}, bonusActivities: {} };
        this.notifyHabits();
        this.notifyGamification();
    }

    habitsRef(uid = this.user?.uid) {
        return collection(db, "users", uid, "habits");
    }

    habitRef(id) {
        return doc(db, "users", this.user.uid, "habits", id);
    }

    settingsRef(uid = this.user?.uid) {
        return doc(db, "users", uid, "settings", "app");
    }

    gamificationRef(uid = this.user?.uid) {
        return doc(db, "users", uid, "gamification", "data");
    }

    listenHabits(uid) {
        if (this.unsubscribeHabits) this.unsubscribeHabits();
        const q = query(this.habitsRef(uid), orderBy("order"));
        this.unsubscribeHabits = onSnapshot(q, (snapshot) => {
            this.habits = snapshot.docs.map((item) => normalizeHabit({ id: item.id, ...item.data() }));
            this.notifyHabits();
        }, (error) => {
            showAuthError(`Firestore error: ${error.message}`);
        });
    }

    subscribeToSettings(uid) {
        if (this.unsubscribeSettings) this.unsubscribeSettings();
        this.unsubscribeSettings = onSnapshot(this.settingsRef(uid), (snapshot) => {
            this.settings = { theme: "theme-dark", ...snapshot.data() };
            saveLocalSettings(this.settings);
            this.notifySettings();
        });
    }

    subscribeToGamification(uid) {
        if (this.unsubscribeGamification) this.unsubscribeGamification();
        this.unsubscribeGamification = onSnapshot(this.gamificationRef(uid), (snapshot) => {
            this.gamification = { coins: 0, awardedHabits: {}, bonusActivities: {}, ...snapshot.data() };
            this.notifyGamification();
        });
    }

    getActivityDefs() {
        return this.gamification.activityDefs || DEFAULT_ACTIVITIES;
    }

    async ensureUserSeeded(uid) {
        const seededRef = doc(db, "users", uid, "meta", "seed");
        const seeded = await getDoc(seededRef);
        if (seeded.exists()) return;

        const existing = await getDocs(this.habitsRef(uid));
        if (!existing.empty) {
            await setDoc(seededRef, { seededAt: Date.now(), source: "existing" });
            return;
        }

        const sourceHabits = readLegacyHabits();
        const habits = sourceHabits.length ? sourceHabits : createDefaultHabits();
        const batch = writeBatch(db);
        habits.forEach((habit, index) => {
            const ref = doc(this.habitsRef(uid));
            batch.set(ref, serializeHabit({ ...normalizeHabit(habit), order: index }));
        });
        batch.set(seededRef, { seededAt: Date.now(), source: sourceHabits.length ? "localStorage" : "defaults" });
        batch.set(this.settingsRef(uid), loadLocalSettings(), { merge: true });
        await batch.commit();
    }

    async addHabit(data) {
        if (!this.user) return;
        const habit = normalizeHabit({ ...data, order: this.habits.length, history: [] });
        await addDoc(this.habitsRef(), serializeHabit(habit));
    }

    async updateHabit(id, data) {
        if (!this.user) return;
        const current = this.habits.find((habit) => habit.id === id);
        if (!current) return;
        await updateDoc(this.habitRef(id), serializeHabit({ ...current, ...data, id, updatedAt: Date.now() }));
    }

    async toggleDate(id, dateStr) {
        if (!this.user) return;
        const habit = this.habits.find((item) => item.id === id);
        if (!habit) return;
        const exists = habit.history.includes(dateStr);
        const history = exists
            ? habit.history.filter((day) => day !== dateStr)
            : [...habit.history, dateStr].sort();
        await updateDoc(this.habitRef(id), { history, updatedAt: Date.now() });
        if (!exists && dateStr === getDateString(new Date())) {
            await this._awardHabitCoins(id, dateStr);
        }
    }

    async _awardHabitCoins(habitId, dateStr) {
        const awarded = this.gamification.awardedHabits || {};
        const dayAwarded = awarded[dateStr] || [];
        if (dayAwarded.includes(habitId)) return;
        const habit = this.habits.find(h => h.id === habitId);
        const coinAmount = habit?.coins || COINS_PER_HABIT;
        await setDoc(this.gamificationRef(), {
            coins: (this.gamification.coins || 0) + coinAmount,
            awardedHabits: { ...awarded, [dateStr]: [...dayAwarded, habitId] }
        }, { merge: true });
    }

    async toggleBonusActivity(date, activityId) {
        if (!this.user) return;
        const bonusActivities = this.gamification.bonusActivities || {};
        const dayData = bonusActivities[date] || {};
        const isDone = Boolean(dayData[activityId]);
        const activity = this.getActivityDefs().find(a => a.id === activityId);
        if (!activity) return;
        const coins = Math.max(0, (this.gamification.coins || 0) + (isDone ? -activity.coins : activity.coins));
        await setDoc(this.gamificationRef(), {
            coins,
            bonusActivities: { ...bonusActivities, [date]: { ...dayData, [activityId]: !isDone } }
        }, { merge: true });
    }

    async addWater(date) {
        if (!this.user) return;
        const bonusActivities = this.gamification.bonusActivities || {};
        const dayData = bonusActivities[date] || {};
        const glasses = dayData.water500 || 0;
        if (glasses >= WATER_GOAL_GLASSES) return;
        await setDoc(this.gamificationRef(), {
            coins: (this.gamification.coins || 0) + COINS_PER_WATER,
            bonusActivities: { ...bonusActivities, [date]: { ...dayData, water500: glasses + 1 } }
        }, { merge: true });
    }

    async removeWater(date) {
        if (!this.user) return;
        const bonusActivities = this.gamification.bonusActivities || {};
        const dayData = bonusActivities[date] || {};
        const glasses = dayData.water500 || 0;
        if (glasses <= 0) return;
        await setDoc(this.gamificationRef(), {
            coins: Math.max(0, (this.gamification.coins || 0) - COINS_PER_WATER),
            bonusActivities: { ...bonusActivities, [date]: { ...dayData, water500: glasses - 1 } }
        }, { merge: true });
    }

    async purchaseItem(itemId, cost) {
        if (!this.user) return false;
        const coins = this.gamification.coins || 0;
        if (coins < cost) return false;
        await setDoc(this.gamificationRef(), { coins: coins - cost }, { merge: true });
        return true;
    }

    async saveActivityDef(data) {
        if (!this.user) return;
        const existing = this.getActivityDefs();
        const idx = existing.findIndex(a => a.id === data.id);
        const updated = idx >= 0
            ? existing.map((a, i) => i === idx ? { ...a, ...data } : a)
            : [...existing, { ...data, id: data.id || createId() }];
        await setDoc(this.gamificationRef(), { activityDefs: updated }, { merge: true });
    }

    async deleteActivityDef(id) {
        if (!this.user) return;
        const updated = this.getActivityDefs().filter(a => a.id !== id);
        await setDoc(this.gamificationRef(), { activityDefs: updated }, { merge: true });
    }

    async saveCustomReward(data) {
        if (!this.user) return;
        const existing = this.gamification.customRewards || [];
        const idx = existing.findIndex(r => r.id === data.id);
        const updated = idx >= 0
            ? existing.map((r, i) => i === idx ? { ...r, ...data } : r)
            : [...existing, { ...data, id: data.id || createId() }];
        await setDoc(this.gamificationRef(), { customRewards: updated }, { merge: true });
    }

    async deleteCustomReward(id) {
        if (!this.user) return;
        const existing = this.gamification.customRewards || [];
        await setDoc(this.gamificationRef(), {
            customRewards: existing.filter(r => r.id !== id)
        }, { merge: true });
    }

    async delete(id) {
        if (!this.user) return;
        await deleteDoc(this.habitRef(id));
        await this.reorderAfterDelete(id);
    }

    async reorderAfterDelete(deletedId) {
        const remaining = this.habits.filter((habit) => habit.id && habit.id !== deletedId);
        const batch = writeBatch(db);
        remaining.forEach((habit, index) => {
            batch.update(this.habitRef(habit.id), { order: index, updatedAt: Date.now() });
        });
        await batch.commit();
    }

    async move(id, direction) {
        if (!this.user) return;
        const sorted = [...this.habits].sort((a, b) => a.order - b.order);
        const index = sorted.findIndex((habit) => habit.id === id);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= sorted.length) return;
        [sorted[index], sorted[nextIndex]] = [sorted[nextIndex], sorted[index]];
        const batch = writeBatch(db);
        sorted.forEach((habit, order) => {
            batch.update(this.habitRef(habit.id), { order, updatedAt: Date.now() });
        });
        await batch.commit();
    }

    async setTheme(theme) {
        this.settings = { ...this.settings, theme };
        saveLocalSettings(this.settings);
        this.notifySettings();
        if (this.user) await setDoc(this.settingsRef(), this.settings, { merge: true });
    }

    listen(callback) {
        this.habitListeners.push(callback);
        callback(this.habits);
    }

    listenSettings(callback) {
        this.settingsListeners.push(callback);
        callback(this.settings);
    }

    onGamification(callback) {
        this.gamificationListeners.push(callback);
        callback(this.gamification);
    }

    notifyHabits() {
        this.habitListeners.forEach((cb) => cb(this.habits));
    }

    notifySettings() {
        this.settingsListeners.forEach((cb) => cb(this.settings));
    }

    notifyGamification() {
        this.gamificationListeners.forEach((cb) => cb(this.gamification));
    }
}

class HabitView {
    constructor() {
        this.todayList = document.getElementById("habit-list");
        this.weekView = document.getElementById("view-week");
        this.monthView = document.getElementById("view-month");
        this.detailView = document.getElementById("view-detail");
        this.emptyState = document.getElementById("empty-state");
        this.completedCount = document.getElementById("completed-count");
        this.progressBar = document.getElementById("progress-bar");
        this.screenTitle = document.getElementById("screen-title");
        this.screenEyebrow = document.getElementById("screen-eyebrow");
    }

    renderProgress(habits) {
        const today = getDateString(new Date());
        const scheduled = habits.filter((habit) => isScheduledToday(habit));
        const done = scheduled.filter((habit) => habit.history.includes(today)).length;
        const percent = scheduled.length ? Math.round((done / scheduled.length) * 100) : 0;
        this.completedCount.textContent = done;
        this.progressBar.style.width = `${percent}%`;
    }

    renderToday(habits, handlers) {
        this.todayList.innerHTML = "";
        const today = getDateString(new Date());
        const sorted = [...habits].sort((a, b) => a.order - b.order);
        this.emptyState.classList.toggle("hidden", sorted.length > 0);

        sorted.forEach((habit, index) => {
            const isDue = isScheduledToday(habit);
            const isDone = habit.history.includes(today);
            const div = document.createElement("article");
            div.className = `habit-item ${habit.color} ${isDone ? "completed" : ""} ${!isDue ? "muted" : ""}`;
            div.innerHTML = `
                <button class="habit-main" type="button">
                    <span class="habit-icon">${escapeHtml(habit.icon)}</span>
                    <span class="habit-copy">
                        <strong>${escapeHtml(habit.name)}</strong>
                        <small>${habitSubtitle(habit, isDone, isDue)}</small>
                    </span>
                    <span class="streak-chip">${getCurrentStreak(habit)}d</span>
                </button>
                <button class="done-btn" type="button" ${!isDue ? "disabled" : ""} aria-label="Отметить">${isDone ? "✓" : ""}</button>
                <div class="habit-tools">
                    <button type="button" data-action="up" aria-label="Выше">⌃</button>
                    <button type="button" data-action="down" aria-label="Ниже">⌄</button>
                    <button type="button" data-action="edit" aria-label="Редактировать">✎</button>
                </div>
            `;
            div.querySelector(".habit-main").onclick = () => handlers.openDetail(habit.id);
            div.querySelector(".done-btn").onclick = () => handlers.toggle(habit.id, today);
            div.querySelector('[data-action="up"]').disabled = index === 0;
            div.querySelector('[data-action="down"]').disabled = index === sorted.length - 1;
            div.querySelector('[data-action="up"]').onclick = () => handlers.move(habit.id, -1);
            div.querySelector('[data-action="down"]').onclick = () => handlers.move(habit.id, 1);
            div.querySelector('[data-action="edit"]').onclick = () => handlers.edit(habit.id);
            this.todayList.appendChild(div);
        });
    }

    renderWeek(habits, handlers) {
        this.weekView.innerHTML = "";
        if (!habits.length) {
            this.weekView.appendChild(createEmptyView("Пока нечего показывать", "Добавь привычку, и здесь появится недельный трек."));
            return;
        }
        habits.forEach((habit) => {
            const card = document.createElement("article");
            card.className = "habit-display-card";
            card.innerHTML = `<div class="card-title"><span>${escapeHtml(habit.icon)}</span>${escapeHtml(habit.name)}</div><div class="week-strip"></div>`;
            const strip = card.querySelector(".week-strip");
            for (let i = 6; i >= 0; i--) {
                const day = new Date();
                day.setDate(day.getDate() - i);
                const dateString = getDateString(day);
                const dot = document.createElement("button");
                dot.type = "button";
                dot.className = `day-dot ${habit.history.includes(dateString) ? "done" : ""}`;
                dot.textContent = shortWeekday(day);
                dot.title = dateString;
                dot.onclick = () => handlers.toggle(habit.id, dateString);
                strip.appendChild(dot);
            }
            this.weekView.appendChild(card);
        });
    }

    renderOverall(habits) {
        this.monthView.innerHTML = "";
        if (!habits.length) {
            this.monthView.appendChild(createEmptyView("История пустая", "Отмечай привычки каждый день, чтобы увидеть общую картину."));
            return;
        }
        habits.forEach((habit) => {
            const card = document.createElement("article");
            card.className = "habit-display-card";
            card.innerHTML = `
                <div class="card-title">
                    <span>${escapeHtml(habit.icon)}</span>${escapeHtml(habit.name)}
                    <small>${getCurrentStreak(habit)} day streak</small>
                </div>
                <div class="mini-month-grid"></div>
            `;
            const grid = card.querySelector(".mini-month-grid");
            for (let i = 59; i >= 0; i--) {
                const day = new Date();
                day.setDate(day.getDate() - i);
                const dot = document.createElement("span");
                dot.className = `dot ${habit.history.includes(getDateString(day)) ? "done" : ""}`;
                grid.appendChild(dot);
            }
            this.monthView.appendChild(card);
        });
    }

    renderAnalytics(habits) {
        document.getElementById("best-streak").textContent = habits.reduce((max, habit) => Math.max(max, getBestStreak(habit)), 0);
        document.getElementById("active-habits").textContent = habits.length;

        const scoreCanvas = document.getElementById("scoreChart");
        const activityCanvas = document.getElementById("activityChart");
        if (!window.Chart || !scoreCanvas || !activityCanvas) return;

        const labels = [];
        const scoreData = [];
        const countData = [];
        const dateActivityMap = {};
        for (let i = 29; i >= 0; i--) {
            const day = new Date();
            day.setDate(day.getDate() - i);
            const dateString = getDateString(day);
            const scheduled = habits.filter((habit) => isScheduledOn(habit, day));
            const doneCount = habits.filter((habit) => habit.history.includes(dateString)).length;
            const scoreCount = scheduled.filter((habit) => habit.history.includes(dateString)).length;
            labels.push(day.getDate());
            countData.push(doneCount);
            scoreData.push(Math.round((scoreCount / (scheduled.length || 1)) * 100));
            dateActivityMap[dateString] = doneCount;
        }
        document.getElementById("total-completed-badge").textContent = `${countData.reduce((sum, count) => sum + count, 0)} total`;

        if (window.scoreChartInstance) window.scoreChartInstance.destroy();
        if (window.activityChartInstance) window.activityChartInstance.destroy();

        const styles = getComputedStyle(document.body);
        const colorText = styles.getPropertyValue("--text-dim").trim();
        const colorGrid = styles.getPropertyValue("--border").trim();
        const accentColor = styles.getPropertyValue("--accent-blue").trim();
        const ctxScore = scoreCanvas.getContext("2d");
        const gradient = ctxScore.createLinearGradient(0, 0, 0, 220);
        gradient.addColorStop(0, "rgba(61, 132, 255, 0.45)");
        gradient.addColorStop(1, "rgba(61, 132, 255, 0)");

        window.scoreChartInstance = new Chart(ctxScore, {
            type: "line",
            data: { labels, datasets: [{ data: scoreData, borderColor: accentColor, backgroundColor: gradient, borderWidth: 3, tension: 0.42, fill: true, pointRadius: 0, pointHoverRadius: 5 }] },
            options: chartOptions(colorText, colorGrid, { max: 100, hideYTicks: true })
        });
        window.activityChartInstance = new Chart(activityCanvas.getContext("2d"), {
            type: "bar",
            data: { labels, datasets: [{ data: countData, backgroundColor: accentColor, borderRadius: 8, barThickness: 7 }] },
            options: chartOptions(colorText, colorGrid)
        });
        this.renderHeatmap(dateActivityMap);
    }

    renderHeatmap(dataMap) {
        const grid = document.getElementById("heatmap-grid");
        const header = document.getElementById("heatmap-header");
        const monthLabel = document.getElementById("heatmap-month-name");
        grid.innerHTML = "";
        header.innerHTML = "";
        const now = new Date();
        monthLabel.textContent = now.toLocaleString("ru", { month: "long" });
        ["S", "M", "T", "W", "T", "F", "S"].forEach((day) => {
            const el = document.createElement("div");
            el.textContent = day;
            header.appendChild(el);
        });
        const year = now.getFullYear();
        const month = now.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        for (let i = 0; i < firstDay.getDay(); i++) {
            const el = document.createElement("div");
            el.className = "cal-cell empty";
            grid.appendChild(el);
        }
        for (let i = 1; i <= lastDay.getDate(); i++) {
            const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
            const count = dataMap[dateString] || 0;
            const el = document.createElement("div");
            el.className = "cal-cell";
            if (count > 0) el.classList.add("level-1");
            if (count > 2) el.classList.add("level-2");
            if (count > 4) el.classList.add("level-3");
            el.textContent = i;
            grid.appendChild(el);
        }
    }

    renderDetail(habit, handlers) {
        if (!habit) return;
        const today = getDateString(new Date());
        const doneToday = habit.history.includes(today);
        this.detailView.innerHTML = `
            <article class="detail-card ${habit.color}">
                <div class="detail-head">
                    <button class="plain-btn light" id="back-to-today">Назад</button>
                    <button class="plain-btn light" id="edit-detail">Edit</button>
                </div>
                <div class="detail-icon">${escapeHtml(habit.icon)}</div>
                <h2>${escapeHtml(habit.name)}</h2>
                <p>${repeatLabel(habit.repeatDays)}</p>
                <div class="detail-stats">
                    <span><strong>${getCurrentStreak(habit)}</strong> current</span>
                    <span><strong>${getBestStreak(habit)}</strong> best</span>
                    <span><strong>${habit.history.length}</strong> total</span>
                </div>
                <button class="btn-primary detail-done" id="toggle-detail">${doneToday ? "Undo today" : "Done today"}</button>
            </article>
            <article class="habit-display-card">
                <div class="card-title">Последние 90 дней</div>
                <div class="detail-grid">${renderDetailDots(habit)}</div>
            </article>
            <button class="btn-danger" id="delete-detail">Удалить привычку</button>
        `;
        document.getElementById("back-to-today").onclick = () => handlers.back();
        document.getElementById("edit-detail").onclick = () => handlers.edit(habit.id);
        document.getElementById("toggle-detail").onclick = () => handlers.toggle(habit.id, today);
        document.getElementById("delete-detail").onclick = () => {
            if (confirm("Удалить привычку?")) handlers.delete(habit.id);
        };
    }

    renderShop(gamification, handlers, today) {
        const shopView = document.getElementById("view-shop");
        if (!shopView) return;
        const coins = gamification.coins || 0;
        const bonusData = (gamification.bonusActivities || {})[today] || {};
        const water = bonusData.water500 || 0;
        const waterMl = water * 500;
        const waterPercent = Math.round((water / WATER_GOAL_GLASSES) * 100);
        const activityDefs = gamification.activityDefs || DEFAULT_ACTIVITIES;
        const customRewards = gamification.customRewards || [];
        const allRewards = [
            ...SHOP_ITEMS.map(item => ({ ...item, isBuiltIn: true })),
            ...customRewards.map(item => ({ ...item, isBuiltIn: false }))
        ];

        shopView.innerHTML = `
            <div class="coin-balance-card">
                <span class="coin-icon">⬡</span>
                <div class="coin-info">
                    <strong class="coin-amount">${coins}</strong>
                    <span class="coin-label">монет</span>
                </div>
            </div>

            <div class="shop-section">
                <p class="shop-section-title">Бонусные активности</p>
                <div class="bonus-list">
                    ${activityDefs.map(a => {
                        const done = Boolean(bonusData[a.id]);
                        return `
                        <article class="bonus-card${done ? " bonus-done" : ""}">
                            <span class="bonus-card-icon">${escapeHtml(a.icon)}</span>
                            <div class="bonus-card-info">
                                <strong>${escapeHtml(a.name)}</strong>
                                <span>${done ? "Выполнено" : `+${a.coins} ⬡`}</span>
                            </div>
                            <button class="card-edit-btn" data-edit-activity="${a.id}" type="button" title="Редактировать">✎</button>
                            <button class="bonus-toggle" data-activity="${a.id}" type="button">${done ? "✓" : "○"}</button>
                        </article>`;
                    }).join("")}
                </div>
                <button class="add-item-btn" id="add-activity-btn" type="button">+ Добавить активность</button>
            </div>

            <div class="shop-section">
                <p class="shop-section-title">Трекер воды</p>
                <div class="water-card">
                    <div class="water-status">
                        <span class="water-amount">${waterMl} мл</span>
                        <span class="water-goal-label">/ ${WATER_GOAL_GLASSES * 500} мл</span>
                        <span class="water-earned">+${water * COINS_PER_WATER} ⬡</span>
                    </div>
                    <div class="water-track">
                        <div class="water-fill" style="width: ${waterPercent}%"></div>
                    </div>
                    <div class="water-controls">
                        <button class="water-btn" id="water-minus" type="button"${water <= 0 ? " disabled" : ""}>−</button>
                        <div class="water-glasses">
                            ${Array.from({ length: WATER_GOAL_GLASSES }, (_, i) =>
                                `<span class="water-glass${i < water ? " filled" : ""}">◉</span>`
                            ).join("")}
                        </div>
                        <button class="water-btn" id="water-plus" type="button"${water >= WATER_GOAL_GLASSES ? " disabled" : ""}>+</button>
                    </div>
                    <p class="water-hint">Каждые 500 мл = ${COINS_PER_WATER} ⬡</p>
                </div>
            </div>

            <div class="shop-section">
                <p class="shop-section-title">Магазин наград</p>
                <div class="reward-list">
                    ${allRewards.map(item => {
                        const canAfford = coins >= item.cost;
                        return `
                        <article class="reward-card${!canAfford ? " reward-locked" : ""}">
                            <span class="reward-icon">${item.icon}</span>
                            <div class="reward-info">
                                <strong>${escapeHtml(item.name)}</strong>
                                <span class="reward-cost">${item.cost} ⬡</span>
                            </div>
                            <button class="card-edit-btn${item.isBuiltIn ? " invisible" : ""}" data-edit-reward="${item.id}" type="button" title="Редактировать">✎</button>
                            <button class="reward-buy" data-item="${item.id}" data-cost="${item.cost}" type="button"${!canAfford ? " disabled" : ""}>Купить</button>
                        </article>`;
                    }).join("")}
                </div>
                <button class="add-item-btn" id="add-reward-btn" type="button">+ Добавить награду</button>
            </div>
        `;

        shopView.querySelectorAll(".bonus-toggle").forEach(btn => {
            btn.onclick = () => handlers.toggleBonus(today, btn.dataset.activity);
        });
        shopView.querySelectorAll("[data-edit-activity]").forEach(btn => {
            btn.onclick = () => handlers.editActivity(btn.dataset.editActivity);
        });
        shopView.querySelectorAll("[data-edit-reward]").forEach(btn => {
            if (!btn.classList.contains("invisible")) {
                btn.onclick = () => handlers.editReward(btn.dataset.editReward);
            }
        });
        const minus = shopView.querySelector("#water-minus");
        const plus = shopView.querySelector("#water-plus");
        if (minus) minus.onclick = () => handlers.removeWater(today);
        if (plus) plus.onclick = () => handlers.addWater(today);
        shopView.querySelectorAll(".reward-buy:not(:disabled)").forEach(btn => {
            btn.onclick = () => handlers.purchase(btn.dataset.item, Number(btn.dataset.cost));
        });
        const addActivityBtn = shopView.querySelector("#add-activity-btn");
        if (addActivityBtn) addActivityBtn.onclick = () => handlers.addActivity();
        const addRewardBtn = shopView.querySelector("#add-reward-btn");
        if (addRewardBtn) addRewardBtn.onclick = () => handlers.addReward();
    }

    setTitle(tab) {
        const titles = {
            today: ["Сегодня", "Habits"],
            week: ["7 дней", "Weekly"],
            month: ["Обзор", "Overall"],
            analytics: ["Графики", "Analytics"],
            detail: ["Привычка", "Details"],
            shop: ["Магазин", "Rewards"]
        };
        const [eyebrow, title] = titles[tab] || titles.today;
        this.screenEyebrow.textContent = eyebrow;
        this.screenTitle.textContent = title;
    }
}

class HabitPresenter {
    constructor(model, view) {
        this.model = model;
        this.view = view;
        this.lastData = [];
        this.lastGamification = { coins: 0, awardedHabits: {}, bonusActivities: {} };
        this.activeTab = "today";
        this.editingId = null;
        this.detailId = null;
        this.reminderTimer = null;
        this.editingRewardId = null;
        this.editingActivityId = null;
        this.init();
    }

    init() {
        this.setupAuth();
        this.setupPickers();

        this.model.listen((data) => {
            this.lastData = data;
            this.updateUI();
            this.scheduleReminderCheck();
        });
        this.model.listenSettings((settings) => {
            document.body.className = settings.theme || "theme-dark";
            this.updateThemePicker(settings.theme || "theme-dark");
        });
        this.model.onGamification((gamification) => {
            this.lastGamification = gamification;
            this.updateCoinBadge(gamification.coins || 0);
            if (this.activeTab === "shop") {
                this.view.renderShop(gamification, this.shopHandlers(), getDateString(new Date()));
            }
        });
        this.model.onAuth((user) => this.renderAuthState(user));

        document.getElementById("show-add-btn").onclick = () => this.openSheet();
        document.getElementById("close-sheet").onclick = () => this.closeSheet();
        document.getElementById("sheet-backdrop").onclick = () => this.closeAllSheets();
        document.getElementById("settings-btn").onclick = () => this.openSettings();
        document.getElementById("close-settings").onclick = () => this.closeSettings();
        document.getElementById("theme-toggle").onclick = () => this.cycleTheme();
        document.getElementById("test-reminder").onclick = () => this.sendTestNotification();
        document.getElementById("logout-btn").onclick = () => this.model.logout();

        document.getElementById("habit-form").onsubmit = (event) => {
            event.preventDefault();
            const data = this.readForm();
            if (!data.name) return;
            if (data.reminder.enabled) this.requestNotificationPermission();
            if (this.editingId) this.model.updateHabit(this.editingId, data);
            else this.model.addHabit(data);
            this.closeSheet();
        };

        document.getElementById("close-reward-sheet").onclick = () => this.closeRewardSheet();
        document.getElementById("save-reward-btn").onclick = () => this.saveReward();
        document.getElementById("delete-reward-btn").onclick = () => {
            if (this.editingRewardId && confirm("Удалить награду?")) {
                this.model.deleteCustomReward(this.editingRewardId);
                this.closeRewardSheet();
            }
        };

        document.getElementById("close-activity-sheet").onclick = () => this.closeActivitySheet();
        document.getElementById("save-activity-btn").onclick = () => this.saveActivity();
        document.getElementById("delete-activity-btn").onclick = () => {
            if (this.editingActivityId && confirm("Удалить активность?")) {
                this.model.deleteActivityDef(this.editingActivityId);
                this.closeActivitySheet();
            }
        };

        document.querySelectorAll(".nav-btn").forEach((btn) => {
            btn.onclick = () => this.switchTab(btn.dataset.tab);
        });
        document.querySelectorAll("#theme-picker button").forEach((btn) => {
            btn.onclick = () => this.model.setTheme(btn.dataset.theme);
        });
    }

    setupAuth() {
        document.getElementById("auth-form").onsubmit = async (event) => {
            event.preventDefault();
            await this.runAuthAction(() => this.model.login(getAuthEmail(), getAuthPassword()));
        };
        document.getElementById("register-btn").onclick = async () => {
            await this.runAuthAction(() => this.model.register(getAuthEmail(), getAuthPassword()));
        };
        document.getElementById("google-btn").onclick = async () => {
            await this.runAuthAction(() => this.model.loginWithGoogle());
        };
    }

    async runAuthAction(action) {
        showAuthError("");
        try {
            await action();
        } catch (error) {
            showAuthError(authMessage(error));
        }
    }

    renderAuthState(user) {
        document.getElementById("auth-view").classList.toggle("hidden", Boolean(user));
        document.getElementById("app-shell").classList.toggle("hidden", !user);
        if (user) this.switchTab("today");
        else this.closeAllSheets();
    }

    setupPickers() {
        const iconPicker = document.getElementById("icon-picker");
        iconPicker.innerHTML = ICONS.map((icon) => `<button type="button" data-icon="${escapeHtml(icon)}">${escapeHtml(icon)}</button>`).join("");
        iconPicker.querySelectorAll("button").forEach((btn) => {
            btn.onclick = () => selectPickerButton(iconPicker, btn, "selected");
        });
        const colorPicker = document.getElementById("color-picker");
        colorPicker.innerHTML = COLORS.map((color) => `<button type="button" class="${color}" data-color="${color}" aria-label="${color}"></button>`).join("");
        colorPicker.querySelectorAll("button").forEach((btn) => {
            btn.onclick = () => selectPickerButton(colorPicker, btn, "selected");
        });
        const weekdayPicker = document.getElementById("weekday-picker");
        weekdayPicker.innerHTML = WEEKDAYS.map((day) => `<button type="button" data-day="${day.value}">${day.label}</button>`).join("");
        weekdayPicker.querySelectorAll("button").forEach((btn) => {
            btn.onclick = () => btn.classList.toggle("selected");
        });
    }

    switchTab(tab) {
        this.activeTab = tab;
        document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
        const viewEl = document.getElementById(`view-${tab}`);
        if (viewEl) viewEl.classList.remove("hidden");
        document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
        this.view.setTitle(tab);
        this.updateUI();
    }

    openDetail(id) {
        this.activeTab = "detail";
        this.detailId = id;
        document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
        document.getElementById("view-detail").classList.remove("hidden");
        document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));
        this.view.setTitle("detail");
        this.view.renderDetail(this.lastData.find((habit) => habit.id === id), this.handlers());
    }

    openSheet(id = null) {
        this.editingId = id;
        const habit = this.lastData.find((item) => item.id === id);
        document.getElementById("sheet-title").textContent = habit ? "Редактировать" : "Новая привычка";
        document.getElementById("habit-name").value = habit?.name || "";
        document.getElementById("reminder-enabled").checked = Boolean(habit?.reminder?.enabled);
        document.getElementById("reminder-time").value = habit?.reminder?.time || "19:00";
        document.getElementById("habit-coins").value = habit?.coins || COINS_PER_HABIT;
        setPickerValue("icon-picker", "icon", habit?.icon || ICONS[0]);
        setPickerValue("color-picker", "color", habit?.color || COLORS[this.lastData.length % COLORS.length]);
        setWeekdays(habit?.repeatDays || [1, 2, 3, 4, 5, 6, 0]);
        this.showBackdrop();
        document.getElementById("habit-sheet").classList.remove("hidden");
        document.getElementById("habit-name").focus();
    }

    closeSheet() {
        document.getElementById("habit-sheet").classList.add("hidden");
        this.editingId = null;
        this.hideBackdropIfDone();
    }

    openSettings() {
        this.showBackdrop();
        document.getElementById("settings-panel").classList.remove("hidden");
    }

    closeSettings() {
        document.getElementById("settings-panel").classList.add("hidden");
        this.hideBackdropIfDone();
    }

    openRewardSheet(id = null) {
        this.editingRewardId = id;
        const allCustom = this.lastGamification.customRewards || [];
        const reward = allCustom.find(r => r.id === id);
        document.getElementById("reward-sheet-title").textContent = reward ? "Редактировать награду" : "Новая награда";
        document.getElementById("reward-name").value = reward?.name || "";
        document.getElementById("reward-icon").value = reward?.icon || "";
        document.getElementById("reward-cost").value = reward?.cost || "";
        document.getElementById("delete-reward-btn").classList.toggle("hidden", !reward);
        this.showBackdrop();
        document.getElementById("reward-sheet").classList.remove("hidden");
        document.getElementById("reward-name").focus();
    }

    closeRewardSheet() {
        document.getElementById("reward-sheet").classList.add("hidden");
        this.editingRewardId = null;
        this.hideBackdropIfDone();
    }

    saveReward() {
        const name = document.getElementById("reward-name").value.trim();
        const icon = document.getElementById("reward-icon").value.trim() || "◆";
        const cost = parseInt(document.getElementById("reward-cost").value) || 50;
        if (!name) return;
        this.model.saveCustomReward({
            id: this.editingRewardId || createId(),
            name,
            icon,
            cost: Math.max(1, cost)
        });
        this.closeRewardSheet();
    }

    openActivitySheet(id = null) {
        this.editingActivityId = id;
        const activityDefs = this.model.getActivityDefs();
        const activity = activityDefs.find(a => a.id === id);
        document.getElementById("activity-sheet-title").textContent = activity ? "Редактировать активность" : "Новая активность";
        document.getElementById("activity-name").value = activity?.name || "";
        document.getElementById("activity-icon").value = activity?.icon || "";
        document.getElementById("activity-coins").value = activity?.coins || 20;
        document.getElementById("delete-activity-btn").classList.toggle("hidden", !activity);
        this.showBackdrop();
        document.getElementById("activity-sheet").classList.remove("hidden");
        document.getElementById("activity-name").focus();
    }

    closeActivitySheet() {
        document.getElementById("activity-sheet").classList.add("hidden");
        this.editingActivityId = null;
        this.hideBackdropIfDone();
    }

    saveActivity() {
        const name = document.getElementById("activity-name").value.trim();
        const icon = document.getElementById("activity-icon").value.trim() || "◆";
        const coins = parseInt(document.getElementById("activity-coins").value) || 20;
        if (!name) return;
        this.model.saveActivityDef({
            id: this.editingActivityId || createId(),
            name,
            icon,
            coins: Math.max(1, coins)
        });
        this.closeActivitySheet();
    }

    closeAllSheets() {
        document.getElementById("habit-sheet").classList.add("hidden");
        document.getElementById("settings-panel").classList.add("hidden");
        document.getElementById("reward-sheet").classList.add("hidden");
        document.getElementById("activity-sheet").classList.add("hidden");
        document.getElementById("sheet-backdrop").classList.add("hidden");
    }

    showBackdrop() {
        document.getElementById("sheet-backdrop").classList.remove("hidden");
    }

    hideBackdropIfDone() {
        const hidden = ["habit-sheet", "settings-panel", "reward-sheet", "activity-sheet"]
            .every(id => document.getElementById(id).classList.contains("hidden"));
        if (hidden) document.getElementById("sheet-backdrop").classList.add("hidden");
    }

    readForm() {
        const repeatDays = [...document.querySelectorAll("#weekday-picker button.selected")].map((btn) => Number(btn.dataset.day));
        return {
            name: document.getElementById("habit-name").value.trim(),
            icon: document.querySelector("#icon-picker .selected")?.dataset.icon || ICONS[0],
            color: document.querySelector("#color-picker .selected")?.dataset.color || COLORS[0],
            repeatDays: repeatDays.length ? repeatDays : [1, 2, 3, 4, 5, 6, 0],
            coins: Math.max(1, parseInt(document.getElementById("habit-coins").value) || COINS_PER_HABIT),
            reminder: {
                enabled: document.getElementById("reminder-enabled").checked,
                time: document.getElementById("reminder-time").value || "19:00"
            }
        };
    }

    handlers() {
        return {
            toggle: (id, dateString) => this.model.toggleDate(id, dateString),
            edit: (id) => this.openSheet(id),
            move: (id, direction) => this.model.move(id, direction),
            openDetail: (id) => this.openDetail(id),
            delete: (id) => {
                this.model.delete(id);
                this.switchTab("today");
            },
            back: () => this.switchTab("today")
        };
    }

    shopHandlers() {
        return {
            toggleBonus: (date, activityId) => this.model.toggleBonusActivity(date, activityId),
            addWater: (date) => this.model.addWater(date),
            removeWater: (date) => this.model.removeWater(date),
            purchase: async (itemId, cost) => {
                const ok = await this.model.purchaseItem(itemId, cost);
                if (ok) {
                    const allRewards = [
                        ...SHOP_ITEMS,
                        ...(this.lastGamification.customRewards || [])
                    ];
                    const item = allRewards.find(i => i.id === itemId);
                    if (item) this.showToast(`✓ Куплено: ${item.name}`);
                }
            },
            editReward: (id) => this.openRewardSheet(id),
            addReward: () => this.openRewardSheet(),
            editActivity: (id) => this.openActivitySheet(id),
            addActivity: () => this.openActivitySheet()
        };
    }

    updateCoinBadge(coins) {
        const badge = document.getElementById("coin-badge");
        if (badge) badge.textContent = `⬡ ${coins}`;
    }

    showToast(message) {
        const existing = document.querySelector(".purchase-toast");
        if (existing) existing.remove();
        const toast = document.createElement("div");
        toast.className = "purchase-toast";
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    updateUI() {
        this.view.renderProgress(this.lastData);
        this.view.renderToday(this.lastData, this.handlers());
        this.view.renderWeek(this.lastData, this.handlers());
        this.view.renderOverall(this.lastData);
        if (this.activeTab === "analytics") this.view.renderAnalytics(this.lastData);
        if (this.activeTab === "shop") {
            this.view.renderShop(this.lastGamification, this.shopHandlers(), getDateString(new Date()));
        }
        if (this.activeTab === "detail") {
            const habit = this.lastData.find((item) => item.id === this.detailId);
            if (habit) this.view.renderDetail(habit, this.handlers());
            else this.switchTab("today");
        }
    }

    cycleTheme() {
        const themes = ["theme-dark", "theme-graphite", "theme-forest", "theme-light"];
        const current = this.model.settings.theme || "theme-dark";
        const next = themes[(themes.indexOf(current) + 1) % themes.length];
        this.model.setTheme(next);
    }

    updateThemePicker(theme) {
        document.querySelectorAll("#theme-picker button").forEach((btn) => {
            btn.classList.toggle("selected", btn.dataset.theme === theme);
        });
        if (this.activeTab === "analytics") this.view.renderAnalytics(this.lastData);
    }

    async requestNotificationPermission() {
        if (!("Notification" in window)) {
            document.getElementById("notification-status").textContent = "Этот браузер не поддерживает уведомления.";
            return false;
        }
        if (Notification.permission === "granted") return true;
        if (Notification.permission === "denied") return false;
        return (await Notification.requestPermission()) === "granted";
    }

    async sendTestNotification() {
        const ok = await this.requestNotificationPermission();
        if (!ok) return;
        new Notification("Habits", { body: "Уведомления включены." });
    }

    scheduleReminderCheck() {
        if (this.reminderTimer) clearInterval(this.reminderTimer);
        this.reminderTimer = setInterval(() => this.checkReminders(), 30000);
        this.checkReminders();
    }

    async checkReminders() {
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const today = getDateString(now);
        const due = this.lastData.filter((habit) =>
            habit.reminder?.enabled &&
            habit.reminder.time === time &&
            isScheduledToday(habit) &&
            !habit.history.includes(today) &&
            habit.lastReminderDate !== today
        );
        if (!due.length) return;
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        due.forEach((habit) => new Notification(habit.name, { body: "Время выполнить привычку." }));
        due.forEach((habit) => this.model.updateHabit(habit.id, { lastReminderDate: today }));
    }
}

function normalizeHabit(habit) {
    return {
        id: habit.id || createId(),
        name: habit.name || "Новая привычка",
        icon: habit.icon || ICONS[0],
        color: COLORS.includes(habit.color) ? habit.color : COLORS[0],
        order: Number.isFinite(habit.order) ? habit.order : 0,
        repeatDays: Array.isArray(habit.repeatDays) && habit.repeatDays.length ? habit.repeatDays : [1, 2, 3, 4, 5, 6, 0],
        reminder: habit.reminder || { enabled: false, time: "19:00" },
        lastReminderDate: habit.lastReminderDate || "",
        coins: Number.isFinite(habit.coins) && habit.coins > 0 ? Math.round(habit.coins) : COINS_PER_HABIT,
        history: Array.isArray(habit.history) ? [...new Set(habit.history)].sort() : [],
        createdAt: habit.createdAt || Date.now(),
        updatedAt: habit.updatedAt || Date.now()
    };
}

function serializeHabit(habit) {
    const normalized = normalizeHabit(habit);
    return {
        name: normalized.name,
        icon: normalized.icon,
        color: normalized.color,
        order: normalized.order,
        repeatDays: normalized.repeatDays,
        reminder: normalized.reminder,
        lastReminderDate: normalized.lastReminderDate,
        coins: normalized.coins,
        history: normalized.history,
        createdAt: normalized.createdAt,
        updatedAt: Date.now()
    };
}

function createDefaultHabits() {
    return DEFAULT_HABITS.map((habit, index) => normalizeHabit({
        ...habit,
        id: createId(),
        order: index,
        history: [],
        repeatDays: [1, 2, 3, 4, 5, 6, 0],
        reminder: { enabled: false, time: "19:00" }
    }));
}

function readLegacyHabits() {
    for (const key of LEGACY_STORAGE_KEYS) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) return parsed.map(normalizeHabit);
        } catch {
            continue;
        }
    }
    return [];
}

function loadLocalSettings() {
    try {
        return { theme: "theme-dark", ...JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY)) };
    } catch {
        return { theme: "theme-dark" };
    }
}

function saveLocalSettings(settings) {
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
}

function getAuthEmail() {
    return document.getElementById("auth-email").value.trim();
}

function getAuthPassword() {
    return document.getElementById("auth-password").value;
}

function showAuthError(message) {
    document.getElementById("auth-error").textContent = message || "";
}

function authMessage(error) {
    const code = error?.code || "";
    if (code.includes("invalid-credential")) return "Неверный email или пароль.";
    if (code.includes("email-already-in-use")) return "Этот email уже зарегистрирован.";
    if (code.includes("weak-password")) return "Пароль должен быть минимум 6 символов.";
    if (code.includes("popup-closed-by-user")) return "Окно Google входа было закрыто.";
    if (code.includes("unauthorized-domain")) return "Этот домен не добавлен в Firebase Authentication.";
    return error?.message || "Не получилось войти.";
}

function getDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function isScheduledToday(habit) {
    return isScheduledOn(habit, new Date());
}

function isScheduledOn(habit, date) {
    return habit.repeatDays.includes(date.getDay());
}

function shortWeekday(date) {
    return ["S", "M", "T", "W", "T", "F", "S"][date.getDay()];
}

function habitSubtitle(habit, isDone, isDue) {
    const coinAmt = habit.coins || COINS_PER_HABIT;
    if (isDone) return "Done today";
    if (!isDue) return "Rest day";
    if (habit.reminder?.enabled) return `Reminder ${habit.reminder.time} · +${coinAmt} ⬡`;
    return `+${coinAmt} ⬡`;
}

function repeatLabel(days) {
    if (days.length === 7) return "Каждый день";
    return WEEKDAYS.filter((day) => days.includes(day.value)).map((day) => day.label).join(", ");
}

function getCurrentStreak(habit) {
    const history = new Set(habit.history);
    let streak = 0;
    const day = new Date();
    for (let i = 0; i < 365; i++) {
        if (isScheduledOn(habit, day)) {
            if (!history.has(getDateString(day))) break;
            streak++;
        }
        day.setDate(day.getDate() - 1);
    }
    return streak;
}

function getBestStreak(habit) {
    let best = 0;
    let current = 0;
    const dates = [...habit.history].sort();
    dates.forEach((date, index) => {
        if (index === 0 || isNextScheduledDate(habit, dates[index - 1], date)) current++;
        else current = 1;
        best = Math.max(best, current);
    });
    return best;
}

function isNextScheduledDate(habit, previous, current) {
    const day = parseDate(previous);
    for (let i = 0; i < 14; i++) {
        day.setDate(day.getDate() + 1);
        if (isScheduledOn(habit, day)) return getDateString(day) === current;
    }
    return false;
}

function parseDate(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function renderDetailDots(habit) {
    let html = "";
    for (let i = 89; i >= 0; i--) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        html += `<span class="dot ${habit.history.includes(getDateString(day)) ? "done" : ""}"></span>`;
    }
    return html;
}

function chartOptions(colorText, colorGrid, config = {}) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { display: false }, ticks: { color: colorText, maxTicksLimit: 6 } },
            y: {
                beginAtZero: true,
                max: config.max,
                grid: { color: colorGrid },
                ticks: { color: colorText, display: !config.hideYTicks, precision: 0 }
            }
        }
    };
}

function createEmptyView(title, text) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>`;
    return div;
}

function selectPickerButton(container, button, className) {
    container.querySelectorAll("button").forEach((item) => item.classList.remove(className));
    button.classList.add(className);
}

function setPickerValue(id, key, value) {
    const picker = document.getElementById(id);
    picker.querySelectorAll("button").forEach((btn) => btn.classList.toggle("selected", btn.dataset[key] === value));
}

function setWeekdays(days) {
    document.querySelectorAll("#weekday-picker button").forEach((btn) => {
        btn.classList.toggle("selected", days.includes(Number(btn.dataset.day)));
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[char]));
}

function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

new HabitPresenter(new HabitModel(), new HabitView());
