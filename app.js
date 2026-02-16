import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, onSnapshot, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyADGhBYM07ZPTC_yYjaAXzdowJNuO_z2bw",
    authDomain: "habit-4dfbc.firebaseapp.com",
    projectId: "habit-4dfbc",
    storageBucket: "habit-4dfbc.firebasestorage.app",
    messagingSenderId: "1055332478071",
    appId: "1:1055332478071:web:a593820d8ca27bcec82a72"
};

// --- 1. MODEL ---
class HabitModel {
    constructor() {
        this.app = initializeApp(firebaseConfig);
        this.auth = getAuth(this.app);
        this.db = getFirestore(this.app);
        this.user = null;
    }

    async addHabit(name) {
        return await addDoc(collection(this.db, "habits"), {
            name, uid: this.user.uid, history: []
        });
    }

    async toggleDate(id, history, dateStr) {
        let newHistory = history.includes(dateStr) 
            ? history.filter(d => d !== dateStr) 
            : [...history, dateStr];
        const today = new Date().toISOString().split('T')[0];
        return await updateDoc(doc(this.db, "habits", id), { 
            history: newHistory
        });
    }

    async delete(id) {
        return await deleteDoc(doc(this.db, "habits", id));
    }

    listen(callback) {
        const q = query(collection(this.db, "habits"), where("uid", "==", this.user.uid));
        return onSnapshot(q, (snap) => {
            callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
    }
}

// --- 2. VIEW ---
class HabitView {
    constructor() {
        this.todayList = document.getElementById('habit-list');
        this.weekView = document.getElementById('view-week');
        this.monthView = document.getElementById('view-month');
        this.progressInfo = document.getElementById('progress-info');
    }

    // --- Отображение "Сегодня" ---
    renderToday(habits, onToggle, onDelete) {
        this.todayList.innerHTML = "";
        const today = new Date().toISOString().split('T')[0];
        
        habits.forEach(h => {
            const isDone = h.history?.includes(today);
            const div = document.createElement('div');
            div.className = `habit-item ${isDone ? 'completed' : ''}`;
            div.innerHTML = `
                <span style="font-weight:600; font-size:16px;">${h.name}</span>
                <div class="habit-controls">
                    <button class="btn-action">${isDone ? 'Undo' : 'Done'}</button>
                    <button class="btn-action" style="background:rgba(255,255,255,0.1)">×</button>
                </div>`;
            div.querySelector('button').onclick = () => onToggle(h.id, h.history || [], today);
            div.querySelectorAll('button')[1].onclick = () => { if(confirm('Delete?')) onDelete(h.id) };
            this.todayList.appendChild(div);
        });
        const done = habits.filter(h => h.history?.includes(today)).length;
        this.progressInfo.innerText = `${done} completed today`;
    }

    // --- Отображение "Неделя" ---
    renderWeek(habits, onToggle) {
        this.weekView.innerHTML = "";
        const days = ['S','M','T','W','T','F','S'];
        habits.forEach(h => {
            const card = document.createElement('div');
            card.className = 'habit-display-card';
            card.innerHTML = `<div style="font-weight:700; margin-bottom:10px; font-size:18px;">${h.name}</div><div class="week-strip"></div>`;
            const strip = card.querySelector('.week-strip');
            for(let i=6; i>=0; i--) {
                const d = new Date(); d.setDate(d.getDate()-i);
                const ds = d.toISOString().split('T')[0];
                const dot = document.createElement('div');
                dot.className = `day-dot ${h.history?.includes(ds) ? 'done' : ''}`;
                dot.innerText = days[d.getDay()];
                dot.onclick = () => onToggle(h.id, h.history || [], ds);
                strip.appendChild(dot);
            }
            this.weekView.appendChild(card);
        });
    }

    // --- Отображение "Месяц" (Точки) ---
    renderOverall(habits) {
        this.monthView.innerHTML = "";
        habits.forEach(h => {
            const card = document.createElement('div');
            card.className = 'habit-display-card';
            card.innerHTML = `<div style="font-weight:700; display:flex; justify-content:space-between;"><span>${h.name}</span></div><div class="mini-month-grid"></div>`;
            const grid = card.querySelector('.mini-month-grid');
            for(let i=49; i>=0; i--) {
                const d = new Date(); d.setDate(d.getDate()-i);
                const ds = d.toISOString().split('T')[0];
                const dot = document.createElement('div');
                dot.className = `dot ${h.history?.includes(ds) ? 'done' : ''}`;
                grid.appendChild(dot);
            }
            this.monthView.appendChild(card);
        });
    }

    // --- НОВАЯ АНАЛИТИКА ---
    renderAnalytics(habits) {
        const ctxScore = document.getElementById('scoreChart').getContext('2d');
        const ctxActivity = document.getElementById('activityChart').getContext('2d');
        
        // Подготовка данных
        const labels = [];
        const scoreData = [];
        const countData = [];
        const dateActivityMap = {}; // { '2023-10-01': 5 }

        for(let i=29; i>=0; i--) {
            const d = new Date(); d.setDate(d.getDate()-i);
            const ds = d.toISOString().split('T')[0];
            const label = d.getDate(); // число месяца
            
            const doneCount = habits.filter(h => h.history?.includes(ds)).length;
            const totalHabits = habits.length || 1; 

            labels.push(label);
            countData.push(doneCount);
            scoreData.push(Math.round((doneCount / totalHabits) * 100));
            dateActivityMap[ds] = doneCount;
        }

        // Обновляем бейдж "Total"
        const totalCompleted = countData.reduce((a,b)=>a+b, 0);
        document.getElementById('total-completed-badge').innerText = `+${totalCompleted} this month`;

        // Очистка старых графиков
        if (window.scoreChartInstance) window.scoreChartInstance.destroy();
        if (window.activityChartInstance) window.activityChartInstance.destroy();

        // Цвета из CSS
        const colorText = getComputedStyle(document.body).getPropertyValue('--text-dim').trim();
        const colorGrid = getComputedStyle(document.body).getPropertyValue('--border').trim();
        const accentColor = '#007aff';

        // 1. График: Average Score (Линейный с заливкой)
        const gradient = ctxScore.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(0, 122, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(0, 122, 255, 0.0)');

        window.scoreChartInstance = new Chart(ctxScore, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Score %',
                    data: scoreData,
                    borderColor: accentColor,
                    backgroundColor: gradient,
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: colorText, maxTicksLimit: 6 } },
                    y: { beginAtZero: true, max: 100, grid: { color: colorGrid, borderDash: [5, 5] }, ticks: { display: false } }
                }
            }
        });

        // 2. График: Habits Completed (Столбцы)
        window.activityChartInstance = new Chart(ctxActivity, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Completed',
                    data: countData,
                    backgroundColor: accentColor,
                    borderRadius: 4,
                    barThickness: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: colorText, maxTicksLimit: 6 } },
                    y: { beginAtZero: true, grid: { color: colorGrid, borderDash: [5, 5] }, ticks: { color: colorText, stepSize: 2 } }
                }
            }
        });

        // 3. Heatmap
        this.renderHeatmap(dateActivityMap);
    }

    renderHeatmap(dataMap) {
        const grid = document.getElementById('heatmap-grid');
        const header = document.getElementById('heatmap-header');
        const monthLabel = document.getElementById('heatmap-month-name');
        
        grid.innerHTML = ""; header.innerHTML = "";
        
        const now = new Date();
        monthLabel.innerText = now.toLocaleString('default', { month: 'long' });

        const days = ['S','M','T','W','T','F','S'];
        days.forEach(d => header.innerHTML += `<div>${d}</div>`);

        const year = now.getFullYear();
        const month = now.getMonth();
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDayOfWeek = firstDay.getDay(); // 0=Sun

        // Пустые ячейки до начала месяца
        for(let i=0; i<startDayOfWeek; i++) {
            const el = document.createElement('div'); el.className = 'cal-cell empty';
            grid.appendChild(el);
        }

        // Ячейки дней
        for(let i=1; i<=lastDay.getDate(); i++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
            const count = dataMap[dateStr] || 0;
            
            const el = document.createElement('div');
            el.className = `cal-cell`;
            
            if (count > 0) el.classList.add('level-1');
            if (count > 2) el.classList.add('level-2');
            if (count > 4) el.classList.add('level-3');
            
            el.innerText = i;
            grid.appendChild(el);
        }
    }
}

// --- 3. PRESENTER ---
class HabitPresenter {
    constructor(model, view) {
        this.model = model;
        this.view = view;
        this.lastData = [];
        this.init();
    }

    init() {
        onAuthStateChanged(this.model.auth, (user) => {
            if (user) {
                this.model.user = user;
                document.getElementById('auth-view').classList.add('hidden');
                document.getElementById('app-view').classList.remove('hidden');
                this.model.listen((data) => {
                    this.lastData = data;
                    this.updateUI();
                });
            } else {
                document.getElementById('auth-view').classList.remove('hidden');
                document.getElementById('app-view').classList.add('hidden');
            }
        });

        // Theme Toggle
        document.getElementById('theme-toggle').onclick = () => {
            const b = document.body;
            b.className = b.className.includes('dark') ? 'light-theme' : 'dark-theme';
            if(!document.getElementById('view-analytics').classList.contains('hidden')) {
                this.view.renderAnalytics(this.lastData); // Перерисовка графиков для нового цвета
            }
        };

        // Tabs Logic
        document.querySelectorAll('.tab').forEach(t => {
            t.onclick = (e) => {
                const tid = e.target.dataset.tab;
                document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
                e.target.classList.add('active');
                
                ['today', 'week', 'month', 'analytics'].forEach(v => 
                    document.getElementById('view-'+v).classList.add('hidden'));
                
                document.getElementById('view-'+tid).classList.remove('hidden');
                
                if(tid === 'analytics') this.view.renderAnalytics(this.lastData);
            };
        });

        // Add Habit
        document.getElementById('show-add-btn').onclick = () => document.getElementById('add-habit-modal').classList.toggle('hidden');
        document.getElementById('add-btn').onclick = () => {
            const inp = document.getElementById('habit-input');
            if(inp.value) this.model.addHabit(inp.value).then(() => {
                inp.value = "";
                document.getElementById('add-habit-modal').classList.add('hidden');
            });
        };

        // Auth Buttons
        document.getElementById('login-btn').onclick = () => signInWithEmailAndPassword(this.model.auth, document.getElementById('email').value, document.getElementById('pass').value);
        document.getElementById('reg-btn').onclick = () => createUserWithEmailAndPassword(this.model.auth, document.getElementById('email').value, document.getElementById('pass').value);
        document.getElementById('logout-btn').onclick = () => signOut(this.model.auth);
    }

    updateUI() {
        this.view.renderToday(this.lastData, (id, h, ds) => this.model.toggleDate(id, h, ds), (id) => this.model.delete(id));
        this.view.renderWeek(this.lastData, (id, h, ds) => this.model.toggleDate(id, h, ds));
        this.view.renderOverall(this.lastData);
        // Если открыта аналитика, обновляем её в реальном времени
        if(!document.getElementById('view-analytics').classList.contains('hidden')) {
            this.view.renderAnalytics(this.lastData);
        }
    }
}

new HabitPresenter(new HabitModel(), new HabitView());