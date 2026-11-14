
// LUNAR SIGHT - Frontend Controller

// Referencias iniciales de ubicaciones.
// Las coordenadas definitivas se validarán con fuentes cartográficas
// antes de utilizarlas en cálculos astronómicos.

const lunarSites = {
    shackleton: {
        name: "Shackleton Crater",
        description: "Crater of scientific interest near the lunar south pole.",
        latitude: "Pending validation",
        longitude: "Pending validation"
    },

    mons: {
        name: "Mons Mouton",
        description: "Lunar highland region considered for future exploration.",
        latitude: "Pending validation",
        longitude: "Pending validation"
    },

    malapert: {
        name: "Malapert Massif",
        description: "Elevated region of interest near the lunar south pole.",
        latitude: "Pending validation",
        longitude: "Pending validation"
    }
};


// 1. NAVIGATION

const navLinks = document.querySelectorAll(".nav-link");
const views = document.querySelectorAll(".view");

const pageTitles = {
    dashboard: "Mission Overview",
    explorer: "Lunar Explorer",
    simulator: "Sun & Earth Simulator",
    comparator: "Site Comparator"
};

navLinks.forEach(link => {

    link.addEventListener("click", (event) => {

        event.preventDefault();

        const selectedView = link.dataset.view;

        // Update navigation
        navLinks.forEach(item => {
            item.classList.remove("active");
        });

        link.classList.add("active");

        // Update visible section
        views.forEach(view => {
            view.classList.remove("active");
        });

        document.getElementById(selectedView).classList.add("active");

        // Update title
        document.getElementById("pageTitle").textContent =
            pageTitles[selectedView];

        document.getElementById("currentSection").textContent =
            selectedView.toUpperCase();

    });

});


// 2. SITE SELECTOR

const siteSelect = document.getElementById("siteSelect");

siteSelect.addEventListener("change", () => {

    const site = lunarSites[siteSelect.value];

    if (!site) return;

    document.getElementById("siteName").textContent = site.name;

    document.getElementById("siteDescription").textContent =
        site.description;

    document.getElementById("siteLat").textContent =
        site.latitude;

    document.getElementById("siteLon").textContent =
        site.longitude;

    console.log("Selected lunar site:", site);

});


// 3. EXPLORE BUTTON

document.getElementById("exploreButton").addEventListener("click", () => {

    document.querySelector('[data-view="explorer"]').click();

});


// 4. BACKEND CONNECTION

async function checkBackend() {

    try {

        const response = await fetch(
            "http://127.0.0.1:8000/api/health"
        );

        if (!response.ok) {
            throw new Error("Backend response error");
        }

        const data = await response.json();

        console.log("LUNAR SIGHT backend:", data);

    } catch (error) {

        console.error("Backend connection failed:", error);

    }

}


// Initialize application

document.addEventListener("DOMContentLoaded", () => {

    siteSelect.dispatchEvent(new Event("change"));

    checkBackend();

    console.log("LUNAR SIGHT frontend initialized.");

});
