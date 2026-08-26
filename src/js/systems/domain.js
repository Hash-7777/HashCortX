// ============================================================
// systems/domain.js — what kind of business this is, and what it keeps
//
// Two pieces of knowledge, both of them guesses, and about six hundred lines of
// them. Which industry a description belongs to, and what a record in that
// industry ought to have on it — a restaurant order has a table number and a
// waiter, a clinic visit has a patient and a date.
//
// This is the app's opinion about business software, and it decides what a
// person gets when a model is unavailable or answers thinly. It sat in a
// four-thousand-line file where nothing could ask it anything, so nobody knew
// whether the fields it hands out would even satisfy the app's own validation
// gate — which they now do, and which is checked.
//
// It is written as code rather than as a table because that is how it already
// was; turning two hundred and fifty lines of cascading tests into data would
// be a rewrite, and a rewrite of a guess is not worth the risk of changing what
// the guess says. What matters is that the guess can be read and questioned.
//
// Pure: a description in, a name and some field definitions out. No DOM, no
// network, no clock.
//
// Run the checks with: npm run check:systems-domain
// ============================================================
(function () {
  "use strict";

  const slug = (raw, fallback = "item") =>
    String(raw || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;

  // The identifiers the finance records are keyed by. Named once, because both
  // the fields below and the mode's own routing look them up.
  const FINANCE_ENTITY_IDS = {
    accounts: "chart_accounts",
    invoices: "invoices",
    invoiceLines: "invoice_lines",
    payments: "payments",
    expenses: "expenses",
    journal: "journal_entries",
    bank: "bank_transactions",
    summary: "financial_summary",
  };

  function detectDomain(desc) {
    const d = String(desc || "").toLowerCase();
    if (/pizza|burger|restaurant|cafe|dine|bistro|grill|kitchen|food|eatery|brasserie|canteen/.test(d)) return "restaurant";
    if (/hotel|resort|hostel|motel|lodge|hospitality|booking|accommodation/.test(d)) return "hotel";
    if (/clinic|medical|hospital|healthcare|doctor|patient|pharmacy|health/.test(d)) return "healthcare";
    if (/school|student|university|college|course|class|education|academy/.test(d)) return "education";
    if (/gym|fitness|wellness|spa|yoga|sport|training|club/.test(d)) return "fitness";
    if (/real estate|property|rent|lease|agent|realty|housing|mortgage/.test(d)) return "realestate";
    if (/retail|shop|ecommerce|e-commerce|store|boutique|fashion|clothing/.test(d)) return "retail";
    if (/logistics|delivery|transport|shipping|courier|fleet|truck|supply chain/.test(d)) return "logistics";
    if (/manufactur|factory|production|assembly|plant|machining/.test(d)) return "manufacturing";
    if (/hr|human resource|payroll|employee|staff management|talent|recruit/.test(d)) return "hr";
    if (/law|legal|firm|contract|case|attorney|counsel/.test(d)) return "legal";
    if (/jewel|gold|gem|diamond|luxury/.test(d)) return "jewelry";
    if (/saas|software|tech|startup|product|app/.test(d)) return "saas";
    return "generic";
  }

  const DOMAIN_CONFIG = {
    restaurant: {
      name: "Restaurant Management",
      theme: { mode:"light", primary:"#92400e", accent:"#f59e0b" },
      modules: [
        { name:"Live Orders", screen:"kanban", entity:"orders" },
        { name:"Menu",        screen:"list",   entity:"menu_items" },
        { name:"Tables",      screen:"split",  entity:"tables" },
        { name:"Staff",       screen:"split",  entity:"staff" },
        { name:"Inventory",   screen:"list",   entity:"ingredients" },
        { name:"Reports",     screen:"report", entity:"orders" },
      ],
      kpis: {
        orders:  [{label:"Today's Orders",aggregate:"count"},{label:"Total Revenue",field:"total",aggregate:"sum"},{label:"Open Orders",field:"status",aggregate:"count"},{label:"Avg Order",field:"total",aggregate:"avg"}],
        menu_items: [{label:"Menu Items",aggregate:"count"},{label:"Avg Price",field:"price",aggregate:"avg"},{label:"Available",aggregate:"count"}],
      },
      workflows: [
        {id:"dine_flow",name:"Dine-In Flow",stages:["Seated","Order Placed","Preparing","Served","Bill Requested","Paid"]},
        {id:"kitchen",name:"Kitchen Dispatch",stages:["Received","Cooking","Ready","Delivered"]},
      ],
    },
    hotel: {
      name: "Hotel Operations",
      theme: { mode:"light", primary:"#1e3a5f", accent:"#60a5fa" },
      modules: [
        { name:"Reservations", screen:"kanban", entity:"bookings" },
        { name:"Rooms",        screen:"split",  entity:"rooms" },
        { name:"Guests",       screen:"split",  entity:"guests" },
        { name:"Housekeeping", screen:"kanban", entity:"housekeeping" },
        { name:"Services",     screen:"list",   entity:"services" },
        { name:"Revenue",      screen:"report", entity:"bookings" },
      ],
      workflows: [
        {id:"checkin",name:"Check-In Flow",stages:["Reserved","Confirmed","Checked In","Occupied","Checkout Pending","Checked Out"]},
        {id:"housekeeping",name:"Housekeeping",stages:["Dirty","Assigned","Cleaning","Inspected","Ready"]},
      ],
    },
    healthcare: {
      name: "Clinic Management",
      theme: { mode:"light", primary:"#0e7490", accent:"#06b6d4" },
      modules: [
        { name:"Appointments", screen:"kanban", entity:"appointments" },
        { name:"Patients",     screen:"split",  entity:"patients" },
        { name:"Records",      screen:"list",   entity:"medical_records" },
        { name:"Billing",      screen:"list",   entity:"invoices" },
        { name:"Staff",        screen:"split",  entity:"staff" },
        { name:"Analytics",    screen:"report", entity:"appointments" },
      ],
      workflows: [
        {id:"patient_flow",name:"Patient Flow",stages:["Registered","Waiting","With Doctor","Under Observation","Discharged"]},
        {id:"billing",name:"Billing Cycle",stages:["Draft","Sent","Partial","Paid","Overdue"]},
      ],
    },
    education: {
      name: "School Management System",
      theme: { mode:"light", primary:"#3730a3", accent:"#818cf8" },
      modules: [
        { name:"Students",    screen:"split",  entity:"students" },
        { name:"Classes",     screen:"list",   entity:"classes" },
        { name:"Attendance",  screen:"calendar", entity:"attendance" },
        { name:"Grades",      screen:"list",   entity:"grades" },
        { name:"Teachers",    screen:"cards",  entity:"teachers" },
        { name:"Finance",     screen:"report", entity:"fees" },
      ],
      workflows: [
        {id:"enrollment",name:"Enrollment",stages:["Applied","Documents Submitted","Reviewed","Enrolled","Active"]},
        {id:"grading",name:"Grading Cycle",stages:["Assessment Created","In Progress","Submitted","Graded","Published"]},
      ],
    },
    fitness: {
      name: "Fitness Center Management",
      theme: { mode:"dark", primary:"#7c3aed", accent:"#4ade80" },
      modules: [
        { name:"Members",   screen:"split",  entity:"members" },
        { name:"Classes",   screen:"kanban", entity:"classes" },
        { name:"Schedule",  screen:"list",   entity:"schedule" },
        { name:"Trainers",  screen:"split",  entity:"trainers" },
        { name:"Revenue",   screen:"report", entity:"memberships" },
        { name:"Equipment", screen:"list",   entity:"equipment" },
      ],
      workflows: [
        {id:"membership",name:"Membership",stages:["Trial","Pending Payment","Active","Expiring","Renewed","Cancelled"]},
      ],
    },
    realestate: {
      name: "Real Estate Management",
      theme: { mode:"light", primary:"#047857", accent:"#10b981" },
      modules: [
        { name:"Properties", screen:"split",  entity:"properties" },
        { name:"Leads",      screen:"kanban", entity:"leads" },
        { name:"Deals",      screen:"kanban", entity:"deals" },
        { name:"Clients",    screen:"split",  entity:"clients" },
        { name:"Viewings",   screen:"list",   entity:"viewings" },
        { name:"Analytics",  screen:"report", entity:"deals" },
      ],
      workflows: [
        {id:"deal_flow",name:"Deal Pipeline",stages:["Lead","Qualified","Viewing Scheduled","Offer Made","Under Contract","Closed"]},
      ],
    },
    retail: {
      name: "Retail Management",
      theme: { mode:"light", primary:"#db2777", accent:"#f472b6" },
      modules: [
        { name:"Products",  screen:"list",   entity:"products" },
        { name:"Orders",    screen:"kanban", entity:"orders" },
        { name:"Customers", screen:"split",  entity:"customers" },
        { name:"Inventory", screen:"list",   entity:"inventory" },
        { name:"Promotions",screen:"list",   entity:"promotions" },
        { name:"Analytics", screen:"report", entity:"orders" },
      ],
      workflows: [
        {id:"order_flow",name:"Order Fulfillment",stages:["Placed","Payment Confirmed","Picking","Packed","Shipped","Delivered"]},
      ],
    },
    logistics: {
      name: "Logistics & Fleet Management",
      theme: { mode:"dark", primary:"#0369a1", accent:"#38bdf8" },
      modules: [
        { name:"Shipments", screen:"kanban", entity:"shipments" },
        { name:"Routes",    screen:"list",   entity:"routes" },
        { name:"Drivers",   screen:"split",  entity:"drivers" },
        { name:"Fleet",     screen:"list",   entity:"vehicles" },
        { name:"Clients",   screen:"split",  entity:"clients" },
        { name:"Reports",   screen:"report", entity:"shipments" },
      ],
      workflows: [
        {id:"shipment",name:"Shipment Lifecycle",stages:["Booked","Assigned","In Transit","At Depot","Out for Delivery","Delivered"]},
      ],
    },
    manufacturing: {
      name: "Manufacturing Operations",
      theme: { mode:"dark", primary:"#1d4ed8", accent:"#fb923c" },
      modules: [
        { name:"Production Orders", screen:"kanban", entity:"production_orders" },
        { name:"Products",          screen:"list",   entity:"products" },
        { name:"Materials",         screen:"list",   entity:"materials" },
        { name:"Machines",          screen:"split",  entity:"machines" },
        { name:"Quality Control",   screen:"list",   entity:"qc_checks" },
        { name:"Reports",           screen:"report", entity:"production_orders" },
      ],
      workflows: [
        {id:"prod",name:"Production Flow",stages:["Draft","Approved","Materials Sourced","In Production","QC","Completed","Shipped"]},
      ],
    },
    hr: {
      name: "HR Management System",
      theme: { mode:"light", primary:"#6d28d9", accent:"#c4b5fd" },
      modules: [
        { name:"Employees",    screen:"split",  entity:"employees" },
        { name:"Recruitment",  screen:"kanban", entity:"candidates" },
        { name:"Leave",        screen:"kanban", entity:"leave_requests" },
        { name:"Payroll",      screen:"list",   entity:"payroll" },
        { name:"Performance",  screen:"report", entity:"reviews" },
        { name:"Departments",  screen:"list",   entity:"departments" },
      ],
      workflows: [
        {id:"hire",name:"Hiring Pipeline",stages:["Applied","Screened","Interview 1","Interview 2","Offer Sent","Hired","Rejected"]},
        {id:"leave",name:"Leave Approval",stages:["Submitted","Manager Review","HR Review","Approved","Rejected"]},
      ],
    },
    legal: {
      name: "Legal Case Management",
      theme: { mode:"light", primary:"#1c1917", accent:"#d97706" },
      modules: [
        { name:"Cases",      screen:"kanban", entity:"cases" },
        { name:"Clients",    screen:"split",  entity:"clients" },
        { name:"Documents",  screen:"list",   entity:"documents" },
        { name:"Hearings",   screen:"calendar", entity:"hearings" },
        { name:"Billing",    screen:"list",   entity:"invoices" },
        { name:"Analytics",  screen:"report", entity:"cases" },
      ],
      workflows: [
        {id:"case_flow",name:"Case Lifecycle",stages:["Intake","Discovery","Filing","Hearing","Judgement","Closed"]},
        {id:"billing",name:"Billing",stages:["Draft","Sent","Partial","Paid","Overdue"]},
      ],
    },
    jewelry: {
      name: "Jewelry Management",
      theme: { mode:"dark", primary:"#b45309", accent:"#fbbf24" },
      modules: [
        { name:"Inventory",  screen:"cards",  entity:"jewelry" },
        { name:"Orders",     screen:"kanban", entity:"orders" },
        { name:"Customers",  screen:"split",  entity:"customers" },
        { name:"Suppliers",  screen:"list",   entity:"suppliers" },
        { name:"Appraisals", screen:"list",   entity:"appraisals" },
        { name:"Revenue",    screen:"report", entity:"orders" },
      ],
      workflows: [
        {id:"order",name:"Order Flow",stages:["Inquiry","Quote Sent","Deposit","In Production","Ready","Delivered","Paid"]},
      ],
    },
    // A description mentioning software or a startup is recognised as this and
    // always has been — the finance profiles below have carried an entry for
    // it since they were written. It simply had no configuration here, so a
    // system for one arrived furnished as a nameless generic business. Named
    // now, with the modules such a company actually runs.
    saas: {
      name: "SaaS Operations",
      theme: { mode:"light", primary:"#4f46e5", accent:"#06b6d4" },
      modules: [
        { name:"Dashboard",     screen:"dashboard", entity:"metrics" },
        { name:"Accounts",      screen:"list",      entity:"accounts" },
        { name:"Subscriptions", screen:"cards",     entity:"subscriptions" },
        { name:"Pipeline",      screen:"kanban",    entity:"pipeline" },
        { name:"Support",       screen:"split",     entity:"tickets" },
        { name:"Revenue",       screen:"report",    entity:"finance" },
      ],
      workflows: [
        {id:"onboarding",name:"Customer Onboarding",stages:["Signed","Kickoff","Configured","Live"]},
        {id:"ticket",name:"Support Ticket",stages:["New","Triaged","In Progress","Resolved"]},
      ],
    },
    generic: {
      name: "Business Operating System",
      theme: { mode:"light", primary:"#2563eb", accent:"#10b981" },
      modules: [
        { name:"Dashboard",  screen:"dashboard", entity:"records" },
        { name:"Records",    screen:"list",      entity:"records" },
        { name:"Pipeline",   screen:"kanban",    entity:"pipeline" },
        { name:"Contacts",   screen:"split",     entity:"contacts" },
        { name:"Finance",    screen:"report",    entity:"finance" },
        { name:"Reports",    screen:"report",    entity:"records" },
      ],
      workflows: [
        {id:"approval",name:"Approval Flow",stages:["Draft","Review","Approved","Closed"]},
      ],
    },
  };

  function defaultFields(entityName, domain = "") {
    const base = slug(entityName);

    // Domain-specific entity fields
    if (domain === "restaurant") {
      if (/order/.test(base)) return [
        { id:"table_number", label:"Table", type:"text", required:true },
        { id:"items", label:"Items Ordered", type:"textarea" },
        { id:"total", label:"Total ($)", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Seated","Order Placed","Preparing","Served","Bill Requested","Paid"] },
        { id:"waiter", label:"Waiter", type:"text" },
        { id:"time_placed", label:"Time Placed", type:"date" },
        { id:"guests", label:"Guests", type:"number" },
      ];
      if (/menu|item/.test(base)) return [
        { id:"item_name", label:"Item Name", type:"text", required:true },
        { id:"category", label:"Category", type:"select", options:["Starters","Mains","Sides","Desserts","Drinks","Specials"] },
        { id:"price", label:"Price ($)", type:"number" },
        { id:"description", label:"Description", type:"textarea" },
        { id:"available", label:"Availability", type:"select", options:["Available","Out of Stock","Seasonal","Discontinued"] },
        { id:"prep_time", label:"Prep Time (min)", type:"number" },
      ];
      if (/table/.test(base)) return [
        { id:"table_number", label:"Table #", type:"text", required:true },
        { id:"capacity", label:"Capacity", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Available","Occupied","Reserved","Cleaning","Closed"] },
        { id:"section", label:"Section", type:"select", options:["Indoor","Outdoor","Bar","Private","Terrace"] },
        { id:"current_guests", label:"Current Guests", type:"number" },
        { id:"seated_at", label:"Seated At", type:"date" },
        { id:"waiter", label:"Assigned Waiter", type:"text" },
      ];
      if (/ingredient/.test(base)) return [
        { id:"name", label:"Ingredient", type:"text", required:true },
        { id:"category", label:"Category", type:"select", options:["Produce","Protein","Dairy","Dry Goods","Beverages","Spices"] },
        { id:"quantity", label:"Qty in Stock", type:"number" },
        { id:"unit", label:"Unit", type:"text" },
        { id:"reorder_level", label:"Reorder At", type:"number" },
        { id:"status", label:"Status", type:"select", options:["In Stock","Low Stock","Out of Stock","Ordered"] },
        { id:"last_ordered", label:"Last Ordered", type:"date" },
      ];
      if (/staff/.test(base)) return [
        { id:"name", label:"Name", type:"text", required:true },
        { id:"role", label:"Role", type:"select", options:["Head Chef","Sous Chef","Line Cook","Waiter","Bartender","Host","Manager","Dishwasher"] },
        { id:"shift", label:"Shift", type:"select", options:["Morning","Afternoon","Evening","Night","Weekend"] },
        { id:"hourly_rate", label:"Hourly Rate ($)", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Active","On Leave","Part-Time","Training","Terminated"] },
        { id:"start_date", label:"Start Date", type:"date" },
      ];
    }

    if (domain === "hotel") {
      if (/booking|reservation/.test(base)) return [
        { id:"guest_name", label:"Guest Name", type:"text", required:true },
        { id:"room_number", label:"Room #", type:"text" },
        { id:"check_in", label:"Check-In", type:"date" },
        { id:"check_out", label:"Check-Out", type:"date" },
        { id:"total", label:"Total ($)", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Reserved","Confirmed","Checked In","Occupied","Checkout Pending","Checked Out","Cancelled"] },
        { id:"guests", label:"Guests", type:"number" },
      ];
      if (/room/.test(base)) return [
        { id:"room_number", label:"Room #", type:"text", required:true },
        { id:"type", label:"Type", type:"select", options:["Standard","Deluxe","Suite","Penthouse","Family Room","Studio"] },
        { id:"floor", label:"Floor", type:"number" },
        { id:"rate", label:"Nightly Rate ($)", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Available","Occupied","Reserved","Maintenance","Cleaning","Out of Order"] },
        { id:"view", label:"View", type:"select", options:["City","Ocean","Garden","Pool","Mountain"] },
        { id:"available_from", label:"Available From", type:"date" },
      ];
      if (/guest/.test(base)) return [
        { id:"name", label:"Guest Name", type:"text", required:true },
        { id:"email", label:"Email", type:"text" },
        { id:"nationality", label:"Nationality", type:"text" },
        { id:"loyalty_tier", label:"Loyalty Tier", type:"select", options:["Bronze","Silver","Gold","Platinum","Diamond"] },
        { id:"visits", label:"Total Stays", type:"number" },
        { id:"last_stay", label:"Last Stay", type:"date" },
      ];
      if (/housekeeping/.test(base)) return [
        { id:"room_number", label:"Room #", type:"text", required:true },
        { id:"housekeeper", label:"Housekeeper", type:"text" },
        { id:"minutes", label:"Minutes", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Dirty","Assigned","Cleaning","Inspected","Ready"] },
        { id:"priority", label:"Priority", type:"select", options:["Normal","Express","Do Not Disturb"] },
        { id:"scheduled", label:"Scheduled", type:"date" },
        { id:"notes", label:"Notes", type:"textarea" },
      ];
    }

    if (domain === "healthcare") {
      if (/patient/.test(base)) return [
        { id:"name", label:"Patient Name", type:"text", required:true },
        { id:"dob", label:"Date of Birth", type:"date" },
        { id:"gender", label:"Gender", type:"select", options:["Male","Female","Other","Prefer not to say"] },
        { id:"blood_type", label:"Blood Type", type:"select", options:["A+","A-","B+","B-","AB+","AB-","O+","O-"] },
        { id:"doctor", label:"Assigned Doctor", type:"text" },
        { id:"status", label:"Status", type:"select", options:["Registered","Waiting","With Doctor","Under Observation","Discharged"] },
        { id:"last_visit", label:"Last Visit", type:"date" },
        { id:"balance", label:"Balance", type:"number" },
      ];
      if (/appointment/.test(base)) return [
        { id:"patient_name", label:"Patient", type:"text", required:true },
        { id:"fee", label:"Fee", type:"number" },
        { id:"doctor", label:"Doctor", type:"text" },
        { id:"department", label:"Department", type:"select", options:["General","Cardiology","Orthopedics","Pediatrics","Neurology","Dermatology","Emergency"] },
        { id:"date", label:"Date", type:"date" },
        { id:"status", label:"Status", type:"select", options:["Scheduled","Confirmed","In Progress","Completed","Cancelled","No Show"] },
        { id:"type", label:"Type", type:"select", options:["Consultation","Follow-Up","Emergency","Check-Up","Procedure"] },
      ];
    }

    if (domain === "fitness") {
      if (/member/.test(base)) return [
        { id:"name", label:"Member Name", type:"text", required:true },
        { id:"email", label:"Email", type:"text" },
        { id:"membership_type", label:"Plan", type:"select", options:["Basic","Standard","Premium","VIP","Student","Corporate"] },
        { id:"status", label:"Status", type:"select", options:["Trial","Active","Expiring","Expired","Cancelled","Frozen"] },
        { id:"join_date", label:"Join Date", type:"date" },
        { id:"monthly_fee", label:"Monthly Fee ($)", type:"number" },
        { id:"trainer", label:"Personal Trainer", type:"text" },
      ];
      if (/class|schedule/.test(base)) return [
        { id:"class_name", label:"Class", type:"text", required:true },
        { id:"trainer", label:"Trainer", type:"text" },
        { id:"date", label:"Date", type:"date" },
        { id:"capacity", label:"Capacity", type:"number" },
        { id:"enrolled", label:"Enrolled", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Scheduled","Full","In Progress","Completed","Cancelled"] },
        { id:"type", label:"Type", type:"select", options:["Yoga","HIIT","Cycling","Pilates","Strength","CrossFit","Cardio","Swim"] },
      ];
    }

    if (domain === "realestate") {
      if (/propert/.test(base)) return [
        { id:"address", label:"Address", type:"text", required:true },
        { id:"type", label:"Type", type:"select", options:["Apartment","Villa","Office","Retail","Land","Warehouse","Townhouse"] },
        { id:"price", label:"Price ($)", type:"number" },
        { id:"bedrooms", label:"Bedrooms", type:"number" },
        { id:"area_sqft", label:"Area (sqft)", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Available","Under Offer","Sold","Off Market","Rented","Maintenance"] },
        { id:"agent", label:"Agent", type:"text" },
        { id:"listed_date", label:"Listed", type:"date" },
      ];
      if (/lead|deal/.test(base)) return [
        { id:"client_name", label:"Client", type:"text", required:true },
        { id:"property", label:"Property Interest", type:"text" },
        { id:"budget", label:"Budget ($)", type:"number" },
        { id:"status", label:"Stage", type:"select", options:["Lead","Qualified","Viewing Scheduled","Offer Made","Under Contract","Closed","Lost"] },
        { id:"agent", label:"Agent", type:"text" },
        { id:"date", label:"Date", type:"date" },
      ];
    }

    if (domain === "logistics") {
      if (/shipment/.test(base)) return [
        { id:"tracking_number", label:"Tracking #", type:"text", required:true },
        { id:"origin", label:"Origin", type:"text" },
        { id:"destination", label:"Destination", type:"text" },
        { id:"weight_kg", label:"Weight (kg)", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Booked","Assigned","In Transit","At Depot","Out for Delivery","Delivered","Failed"] },
        { id:"driver", label:"Driver", type:"text" },
        { id:"expected_date", label:"Expected Delivery", type:"date" },
        { id:"value", label:"Cargo Value ($)", type:"number" },
      ];
    }

    if (domain === "retail") {
      if (/product/.test(base)) return [
        { id:"name", label:"Product Name", type:"text", required:true },
        { id:"sku", label:"SKU", type:"text" },
        { id:"category", label:"Category", type:"select", options:["Clothing","Electronics","Home","Beauty","Sports","Food","Toys","Books"] },
        { id:"price", label:"Price ($)", type:"number" },
        { id:"stock", label:"Stock", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Active","Low Stock","Out of Stock","Discontinued","Coming Soon"] },
        { id:"added_date", label:"Added", type:"date" },
      ];
      if (/order/.test(base)) return [
        { id:"order_number", label:"Order #", type:"text", required:true },
        { id:"customer", label:"Customer", type:"text" },
        { id:"total", label:"Total ($)", type:"number" },
        { id:"items_count", label:"Items", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Placed","Payment Confirmed","Picking","Packed","Shipped","Delivered","Returned"] },
        { id:"date", label:"Order Date", type:"date" },
        { id:"channel", label:"Channel", type:"select", options:["Online","In-Store","Mobile","Marketplace","Phone"] },
      ];
    }

    if (domain === "manufacturing") {
      if (/production|order/.test(base)) return [
        { id:"order_number", label:"Order #", type:"text", required:true },
        { id:"product", label:"Product", type:"text" },
        { id:"quantity", label:"Quantity", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Draft","Approved","Materials Sourced","In Production","QC","Completed","Shipped"] },
        { id:"machine", label:"Machine", type:"text" },
        { id:"start_date", label:"Start Date", type:"date" },
        { id:"due_date", label:"Due Date", type:"date" },
      ];
      if (/material/.test(base)) return [
        { id:"name", label:"Material", type:"text", required:true },
        { id:"supplier", label:"Supplier", type:"text" },
        { id:"quantity", label:"Qty in Stock", type:"number" },
        { id:"unit", label:"Unit", type:"text" },
        { id:"unit_cost", label:"Unit Cost ($)", type:"number" },
        { id:"status", label:"Status", type:"select", options:["In Stock","Low Stock","Out of Stock","Ordered","On Hold"] },
        { id:"last_received", label:"Last Received", type:"date" },
      ];
    }

    if (domain === "hr") {
      if (/employee/.test(base)) return [
        { id:"name", label:"Name", type:"text", required:true },
        { id:"role", label:"Job Title", type:"text" },
        { id:"department", label:"Department", type:"select", options:["Engineering","Finance","Operations","Sales","Marketing","HR","Legal","Product"] },
        { id:"salary", label:"Salary ($)", type:"number" },
        { id:"status", label:"Status", type:"select", options:["Active","On Leave","Probation","Resigned","Terminated"] },
        { id:"start_date", label:"Start Date", type:"date" },
        { id:"manager", label:"Manager", type:"text" },
      ];
      if (/candidate/.test(base)) return [
        { id:"name", label:"Candidate Name", type:"text", required:true },
        { id:"role", label:"Applied Role", type:"text" },
        { id:"email", label:"Email", type:"text" },
        { id:"source", label:"Source", type:"select", options:["LinkedIn","Referral","Job Board","Agency","Direct","University"] },
        { id:"status", label:"Stage", type:"select", options:["Applied","Screened","Interview 1","Interview 2","Offer Sent","Hired","Rejected"] },
        { id:"applied_date", label:"Applied", type:"date" },
        { id:"salary_expectation", label:"Expected Salary ($)", type:"number" },
      ];
    }

    // Generic entity-name-based fallbacks
    if (/inventory|product|stock|item/.test(base)) return [
      { id:"name", label:"Item", type:"text", required:true },
      { id:"sku", label:"SKU", type:"text" },
      { id:"stock", label:"Stock", type:"number" },
      { id:"price", label:"Price", type:"number" },
      { id:"updated", label:"Updated", type:"date" },
      { id:"status", label:"Status", type:"select", options:["Active","Low Stock","Paused"] },
    ];
    if (/employee|hr|staff|payroll/.test(base)) return [
      { id:"name", label:"Name", type:"text", required:true },
      { id:"role", label:"Role", type:"text" },
      { id:"department", label:"Department", type:"select", options:["Operations","Sales","Finance","HR"] },
      { id:"salary", label:"Salary", type:"number" },
      { id:"status", label:"Status", type:"select", options:["Active","On Leave","Review"] },
      { id:"start_date", label:"Start Date", type:"date" },
    ];
    return [
      { id:"name", label:"Name", type:"text", required:true },
      { id:"owner", label:"Owner", type:"text" },
      { id:"amount", label:"Amount", type:"number" },
      { id:"status", label:"Status", type:"select", options:["New","In Progress","Approved","Closed"] },
      { id:"updated", label:"Updated", type:"date" },
    ];
  }

  function financeProfile(spec, desc) {
    const domain = spec.domain || detectDomain(desc || spec.description || "");
    const profiles = {
      restaurant: { baseRevenue:52000, grossMargin:.62, taxRate:.0825, customers:["North Table Events","Downtown Catering","Walk-in Guests","Riverside Delivery","Private Dining"], vendors:["Fresh Farms Co.","Prime Meats","City Beverage Supply","LinenPro"] },
      hotel: { baseRevenue:145000, grossMargin:.58, taxRate:.105, customers:["Corporate Travel Desk","Global Tours","Direct Booking","Conference Group","Family Suite Guests"], vendors:["LinenPro","Metro Maintenance","Guest Supply Co.","Foodservice Direct"] },
      healthcare: { baseRevenue:118000, grossMargin:.54, taxRate:.035, customers:["Insurance Partner A","Self Pay Patients","Corporate Wellness","Family Care Plan","Diagnostics Referral"], vendors:["MedSupply Direct","Lab Services Co.","Clinical Software","SterileWorks"] },
      education: { baseRevenue:82000, grossMargin:.49, taxRate:.02, customers:["Tuition Plans","Corporate Training","Summer Program","Online Courses","Exam Prep"], vendors:["BookSource","Campus Catering","Learning Cloud","Facilities Co."] },
      fitness: { baseRevenue:61000, grossMargin:.66, taxRate:.06, customers:["Monthly Members","Corporate Wellness","Personal Training","Class Packs","Annual Members"], vendors:["EquipmentCare","FitSupply","Trainer Contractors","Wellness Software"] },
      realestate: { baseRevenue:176000, grossMargin:.72, taxRate:.04, customers:["Residential Sellers","Commercial Lease","Buyer Commission","Property Management","Developer Account"], vendors:["Listing Portals","Staging Studio","Legal Closings","Inspection Partners"] },
      retail: { baseRevenue:94000, grossMargin:.45, taxRate:.0875, customers:["Online Store","Flagship Shop","Marketplace Sales","Wholesale Buyer","Loyalty Customers"], vendors:["Northstar Wholesale","Packaging Hub","Payment Processor","Last Mile Freight"] },
      logistics: { baseRevenue:132000, grossMargin:.38, taxRate:.055, customers:["Atlas Imports","Meridian Retail","Cold Chain Client","Express Accounts","Regional Shippers"], vendors:["Fuel Network","Truck Maintenance","Warehouse Lease","Route Software"] },
      manufacturing: { baseRevenue:210000, grossMargin:.34, taxRate:.06, customers:["Apex Industrial","Crestfield Parts","Helix Systems","Norwood Manufacturing","Trident Supply"], vendors:["SteelWorks","CNC Maintenance","Packaging Hub","Safety Supplies"] },
      hr: { baseRevenue:76000, grossMargin:.71, taxRate:.05, customers:["Retainer Clients","Recruiting Fees","Payroll Services","Benefits Admin","HR Advisory"], vendors:["Job Boards","Assessment Tools","Payroll Processor","Legal Counsel"] },
      legal: { baseRevenue:138000, grossMargin:.69, taxRate:.045, customers:["Corporate Counsel","Litigation Client","Estate Planning","Retainer Account","Contract Review"], vendors:["Court Filing Service","Legal Research","Process Servers","Document Storage"] },
      jewelry: { baseRevenue:165000, grossMargin:.42, taxRate:.0825, customers:["Bridal Clients","Collectors","Custom Orders","Boutique Buyers","Repair Customers"], vendors:["Gem Exchange","Gold Refinery","Security Services","Luxury Packaging"] },
      saas: { baseRevenue:123000, grossMargin:.82, taxRate:.04, customers:["Enterprise Plan","Team Subscriptions","Usage Overage","Implementation Fees","Partner Channel"], vendors:["Cloud Hosting","Support Tools","Data Provider","Security Audit"] },
      generic: { baseRevenue:88000, grossMargin:.52, taxRate:.06, customers:["Meridian Co.","Northstar Group","BluePeak LLC","Arion Partners","Crestfield"], vendors:["Office Supply Co.","Cloud Services","Contract Labor","Facilities Vendor"] },
    };
    return { domain, ...(profiles[domain] || profiles.generic) };
  }

  function financeFields(currency) {
    const money = label => `${label} (${currency})`;
    return {
      [FINANCE_ENTITY_IDS.accounts]: [
        { id:"account_code", label:"Account Code", type:"text", required:true },
        { id:"name", label:"Account", type:"text", required:true },
        { id:"type", label:"Type", type:"select", options:["Asset","Liability","Equity","Revenue","Cost of Sales","Expense"] },
        { id:"balance", label:money("Balance"), type:"number" },
        { id:"status", label:"Status", type:"select", options:["Active","Review","Closed"] },
        { id:"updated", label:"Updated", type:"date" },
      ],
      [FINANCE_ENTITY_IDS.invoices]: [
        { id:"invoice_number", label:"Invoice #", type:"text", required:true },
        { id:"customer", label:"Customer", type:"text", required:true },
        { id:"issue_date", label:"Issue Date", type:"date" },
        { id:"due_date", label:"Due Date", type:"date" },
        { id:"subtotal", label:money("Subtotal"), type:"number" },
        { id:"tax", label:money("Tax"), type:"number" },
        { id:"total", label:money("Total"), type:"number" },
        { id:"paid", label:money("Paid"), type:"number" },
        { id:"balance", label:money("Balance"), type:"number" },
        { id:"status", label:"Status", type:"select", options:["Draft","Sent","Partially Paid","Paid","Overdue"] },
      ],
      [FINANCE_ENTITY_IDS.invoiceLines]: [
        { id:"invoice_number", label:"Invoice #", type:"text", required:true },
        { id:"item", label:"Item", type:"text" },
        { id:"quantity", label:"Qty", type:"number" },
        { id:"unit_price", label:money("Unit Price"), type:"number" },
        { id:"line_total", label:money("Line Total"), type:"number" },
        { id:"status", label:"Status", type:"select", options:["Open","Billed","Adjusted"] },
        { id:"date", label:"Date", type:"date" },
      ],
      [FINANCE_ENTITY_IDS.payments]: [
        { id:"payment_number", label:"Payment #", type:"text", required:true },
        { id:"invoice_number", label:"Invoice #", type:"text" },
        { id:"customer", label:"Customer", type:"text" },
        { id:"payment_date", label:"Payment Date", type:"date" },
        { id:"method", label:"Method", type:"select", options:["Bank Transfer","Card","ACH","Cash","Check"] },
        { id:"amount", label:money("Amount"), type:"number" },
        { id:"status", label:"Status", type:"select", options:["Pending","Posted","Reconciled"] },
      ],
      [FINANCE_ENTITY_IDS.expenses]: [
        { id:"expense_number", label:"Expense #", type:"text", required:true },
        { id:"vendor", label:"Vendor", type:"text" },
        { id:"category", label:"Category", type:"select", options:["COGS","Payroll","Rent","Marketing","Software","Utilities","Insurance","Professional Services"] },
        { id:"expense_date", label:"Expense Date", type:"date" },
        { id:"amount", label:money("Amount"), type:"number" },
        { id:"payment_status", label:"Payment Status", type:"select", options:["Accrued","Approved","Paid","Disputed"] },
        { id:"status", label:"Status", type:"select", options:["Submitted","Approved","Paid","Rejected"] },
      ],
      [FINANCE_ENTITY_IDS.journal]: [
        { id:"journal_id", label:"Journal ID", type:"text", required:true },
        { id:"entry_date", label:"Entry Date", type:"date" },
        { id:"account", label:"Account", type:"text" },
        { id:"source", label:"Source", type:"text" },
        { id:"debit", label:money("Debit"), type:"number" },
        { id:"credit", label:money("Credit"), type:"number" },
        { id:"status", label:"Status", type:"select", options:["Draft","Posted","Reviewed"] },
      ],
      [FINANCE_ENTITY_IDS.bank]: [
        { id:"transaction_id", label:"Transaction ID", type:"text", required:true },
        { id:"transaction_date", label:"Date", type:"date" },
        { id:"description", label:"Description", type:"text" },
        { id:"type", label:"Type", type:"select", options:["Deposit","Withdrawal","Transfer"] },
        { id:"amount", label:money("Amount"), type:"number" },
        { id:"balance", label:money("Running Balance"), type:"number" },
        { id:"status", label:"Status", type:"select", options:["Pending","Cleared","Reconciled"] },
      ],
      [FINANCE_ENTITY_IDS.summary]: [
        { id:"month", label:"Month", type:"date", required:true },
        { id:"revenue", label:money("Revenue"), type:"number" },
        { id:"cost_of_sales", label:money("Cost of Sales"), type:"number" },
        { id:"gross_profit", label:money("Gross Profit"), type:"number" },
        { id:"operating_expenses", label:money("Operating Expenses"), type:"number" },
        { id:"net_profit", label:money("Net Profit"), type:"number" },
        { id:"cash_balance", label:money("Cash Balance"), type:"number" },
        { id:"accounts_receivable", label:money("AR"), type:"number" },
        { id:"accounts_payable", label:money("AP"), type:"number" },
        { id:"status", label:"Status", type:"select", options:["Open","Review","Closed"] },
      ],
    };
  }

  window.HCSystemsDomain = { detectDomain, DOMAIN_CONFIG, FINANCE_ENTITY_IDS, defaultFields, financeProfile, financeFields, slug };
})();
