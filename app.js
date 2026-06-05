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

class HabitModel {
    constructor() {
        this.user = null;
        this.habits = [];
        this.settings = loadLocalSettings();
        this.habitListeners = [];
        this.settingsListeners = [];
        this.unsubscribeHabits = null;
        this.unsubscribeSettings = null;
    }

    onAuth(callback) {
    return onAuthStateChanged(auth, async (user) => {
        this.user = user;
        if (user) {
            try {
                // Пытаемся загрузить данные
                await this.startUserSession(user);
            } catch (error) {
                // Если база данных пока не пускает (правила еще не обновились), 
                // мы перехватываем ошибку, чтобы код не сломался
                console.error("Ошибка при работе с БД:", error);
            }
        } else {
            this.stopUserSession();
        }
        // Этот коллбэк скрывает экран логина. Теперь он выполнится в любом случае!
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
        this.listenSettings(user.uid);
    }

    stopUserSession() {
        if (this.unsubscribeHabits) this.unsubscribeHabits();
        if (this.unsubscribeSettings) this.unsubscribeSettings();
        this.unsubscribeHabits = null;
        this.unsubscribeSettings = null;
        this.habits = [];
        this.notifyHabits();
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

    listenSettings(uid) {
        if (this.unsubscribeSettings) this.unsubscribeSettings();
        this.unsubscribeSettings = onSnapshot(this.settingsRef(uid), (snapshot) => {
            this.settings = { theme: "theme-dark", ...snapshot.data() };
            saveLocalSettings(this.settings);
            this.notifySettings();
        });
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
        const habit = normalizeHabit({
            ...data,
            order: this.habits.length,
            history: []
        });
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

    notifyHabits() {
        this.habitListeners.forEach((callback) => callback(this.habits));
    }

    notifySettings() {
        this.settingsListeners.forEach((callback) => callback(this.settings));
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

    setTitle(tab) {
        const titles = {
            today: ["Сегодня", "Habits"],
            week: ["7 дней", "Weekly"],
            month: ["Обзор", "Overall"],
            analytics: ["Графики", "Analytics"],
            detail: ["Привычка", "Details"]
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
        this.activeTab = "today";
        this.editingId = null;
        this.detailId = null;
        this.reminderTimer = null;
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
        document.getElementById(`view-${tab}`).classList.remove("hidden");
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

    closeAllSheets() {
        document.getElementById("habit-sheet").classList.add("hidden");
        document.getElementById("settings-panel").classList.add("hidden");
        document.getElementById("sheet-backdrop").classList.add("hidden");
    }

    showBackdrop() {
        document.getElementById("sheet-backdrop").classList.remove("hidden");
    }

    hideBackdropIfDone() {
        const habitSheetHidden = document.getElementById("habit-sheet").classList.contains("hidden");
        const settingsHidden = document.getElementById("settings-panel").classList.contains("hidden");
        if (habitSheetHidden && settingsHidden) document.getElementById("sheet-backdrop").classList.add("hidden");
    }

    readForm() {
        const repeatDays = [...document.querySelectorAll("#weekday-picker button.selected")].map((btn) => Number(btn.dataset.day));
        return {
            name: document.getElementById("habit-name").value.trim(),
            icon: document.querySelector("#icon-picker .selected")?.dataset.icon || ICONS[0],
            color: document.querySelector("#color-picker .selected")?.dataset.color || COLORS[0],
            repeatDays: repeatDays.length ? repeatDays : [1, 2, 3, 4, 5, 6, 0],
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

    updateUI() {
        this.view.renderProgress(this.lastData);
        this.view.renderToday(this.lastData, this.handlers());
        this.view.renderWeek(this.lastData, this.handlers());
        this.view.renderOverall(this.lastData);
        if (this.activeTab === "analytics") this.view.renderAnalytics(this.lastData);
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
    if (isDone) return "Done today";
    if (!isDue) return "Rest day";
    if (habit.reminder?.enabled) return `Reminder ${habit.reminder.time}`;
    return "Tap to complete";
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
