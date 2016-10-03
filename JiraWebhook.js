var JiraWebhookProcessor = Class.create();
JiraWebhookProcessor.prototype =  Object.extendsObject(WebhookProcessor, {
	
	process: function() {
		this.debug = false;

		if (this.debug) {
			gs.info("JiraWebhookProcessor received webhook payload:\n" + global.JSON.stringify(this.data));
		}

		switch(this.data.webhookEvent) {
			case "project_created":
			case "project_updated":
				this.update_project();
				break;
			case "project_deleted":
				this.delete_project();
				break;
			case "jira:issue_created":
			case "jira:issue_updated":
				this.update_issue();
				break;
			case "jira:issue_deleted":
				this.delete_issue();
				break;
			case "sprint_created":
			case "sprint_updated":
			case "sprint_started":
			case "sprint_closed":
				this.update_sprint();
				break;
			case "sprint_deleted":
				this.delete_sprint();
				break;
			case "jira:worklog_updated":
				this.update_worklog();
				break;
			case "worklog_deleted":
				this.delete_worklog();
				break;
			default:
				break;
		}
	},

	/* JIRA Project => x_snc_ippy_jira_projects *********************************************************

		webhookEvent = ['project_created', 'project_updated', 'project_deleted']

		Notes:
			- 'description' is not sent in webhook create or update events from JIRA
			- project_deleted does not cascade events on child objects, clean up will be needed
	***************************************************************************************************** */

	update_project: function() {

		key		= this.data.project.key;
		id		= this.data.project.id;
		url		= this.data.project.self;
		name	= this.data.project.name;		
		email	= this.data.project.projectLead.emailAddress;
		host 	= this.get_uri_host(url);

		ownerSysId = this.get_sn_user(email);
		if (!ownerSysId) {
			gs.error("Failed to locate user with email address '" + email + 
				"' for JIRA project '" + key + "' (" + host + ")");
		}

		rec = new GlideRecord('x_snc_ippy_jira_projects');
		rec.addQuery('url', url);
		rec.query();
		rec.next();

		rec.owner 	= ownerSysId;
		rec.name  	= name;
		rec.key 	= key;
		rec.id 		= id;
		rec.host 	= host;
		rec.url 	= url;
		rec.state 	= "Active";
		rec.update();

		return;
	},

	delete_project: function() {
		
		key		= this.data.project.key;
		id		= this.data.project.id;
		url		= this.data.project.self;

		rec = new GlideRecord('x_snc_ippy_jira_projects');
		rec.addQuery('url', url);
		rec.deleteMultiple();

		return;
	},

	/* JIRA Issue => x_snc_ippy_jira_issues *************************************************************

		webhookEvent = ['issue_created', 'issue_updated', 'issue_deleted']

		Notes:
	***************************************************************************************************** */

	update_issue: function() {

		issue = this.data.issue;

		key		= issue.key;
		id		= issue.id;
		url		= issue.self;
		host 	= this.get_uri_host(url);
		type 	= issue.fields.issuetype.name;
		desc 	= issue.fields.description;
		summary = issue.fields.summary;

		// Match JIRA users to SN Users (sys_user) by emailAddress
		creatorEmail  = issue.fields.creator.emailAddress;
		reporterEmail = null;
		assigneeEmail = null;
		if (issue.fields.reporter != null) {
			reporterEmail = issue.fields.reporter.emailAddress;
		}
		if (issue.fields.assignee != null) {
			assigneeEmail = issue.fields.assignee.emailAddress;
		}

		creatorSysId 	= this.get_sn_user(creatorEmail);
		reporterSysId 	= this.get_sn_user(reporterEmail);
		assigneeSysId 	= this.get_sn_user(assigneeEmail);

		// Project reference to x_snc_ippy_jira_projects
		projectSysId	= this.get_sn_project(issue.fields.project.self);

		/* Sprint reference to x_snc_ippy_jira_sprints
		 	Issues have a customfield reference to the sprint, which seems to be
			a toString() invocation on a java object.  Avoiding the assumption that
			the same customfield_1001 is used consistently across versions and instances
		 	of JIRA and assuming boardId + id is sufficiently unique across multiple JIRA
			instances */

		sprintSysId = '';
		for (var property in issue.fields) {
			if (property.match(/customfield_\d{1,}/i) && 
					issue.fields[property] instanceof Array &&
						issue.fields[property].length > 0) {
				for (var i=0; i<issue.fields[property].length; i++) {
					var value = issue.fields[property][i];
					if (value instanceof String && value.match(/^com\.atlassian\.greenhopper\.service\.sprint\.Sprint/i)) {
						// state
						matches = value.match(/state=(.*?),/);
						state 	= matches[1];

						// sprintId
						matches = value.match(/id=(\d{1,}),/);
						sprintId = matches[1];

						// BoardId (rapidViewId?)
						matches = value.match(/rapidViewId=(\d{1,}),/);
						boardId = matches[1];

						if (state != "CLOSED") {
							sprintSysId = this.get_sn_sprint(sprintId, boardId);
						}
					}
				}
			}
		}

		// Now that we know the relationship of a Sprint to Project, patch it. **hack**
		if (!gs.nil(sprintSysId)) {
			this.patch_project_sprint(projectSysId, sprintSysId);
		}

		// Priority
		priority 		= issue.fields.priority.name;
		status 			= issue.fields.status.name;

		if (!creatorSysId) {
			gs.error("Failed to locate creator with email address '" + creatorEmail + 
				"' for JIRA issue '" + key + "' (" + host + ")");
		}

		rec = new GlideRecord('x_snc_ippy_jira_issues');
		rec.addQuery('url', url);
		rec.query();
		rec.next();

		rec.creator 	= creatorSysId;
		rec.reporter 	= reporterSysId;
		rec.assignee 	= assigneeSysId;
		rec.project 	= projectSysId;
		rec.sprint 		= sprintSysId;
		rec.id 			= id;
		rec.url 		= url;
		rec.key 		= key;
		rec.host 		= host;
		rec.type 		= type;
		rec.summary  	= summary;
		rec.priority 	= priority;
		rec.status 		= status;
		rec.description = desc;

		rec.update();

		return;
	},

	delete_issue: function() {
		
		key		= this.data.issue.key;
		id		= this.data.issue.id;
		url		= this.data.issue.self;

		rec = new GlideRecord('x_snc_ippy_jira_issues');
		rec.addQuery('url', url);
		rec.deleteMultiple();

		return;
	},


	/* JIRA Sprint => x_snc_ippy_jira_sprints ***********************************************************

		webhookEvent = ['sprint_updated', 'sprint_created', 'sprint_closed', 'sprint_started']

		Notes:
			- Sprint hooks do not show relationship to a project; hack we'll wait for an issue hook to 
				link them
			- Case where sprint records remain when they are created and a project is deleted before 
				an isuse is linked to the sprint
			- No 'self' in sprint_deleted event, this could cause issues with multiple JIRA instances
	***************************************************************************************************** */

	update_sprint: function() {

		id		= this.data.sprint.id;
		url		= this.data.sprint.self;
		state	= this.data.sprint.state;
		name	= this.data.sprint.name;
		boardId = this.data.sprint.originBoardId;
		host 	= this.get_uri_host(url);

		rec = new GlideRecord('x_snc_ippy_jira_sprints');
		rec.addQuery('url', url);
		rec.query();
		rec.next();

		rec.name  	= name;
		rec.id 		= id;
		rec.host 	= host;
		rec.url 	= url;
		rec.state 	= state;
		rec.boardid = boardId;
		rec.update();

		return;
	},

	delete_sprint: function() {

		// boardId + id is the 'best' option for unique match across multiple instances of JIRA
		
		id		= this.data.sprint.id;
		boardId = this.data.sprint.originBoardId;
		name	= this.data.sprint.name;

		rec = new GlideRecord('x_snc_ippy_jira_sprints');
		rec.addQuery('boardid', boardId);
		rec.addQuery('id', id);
		rec.deleteMultiple();

		return;
	},

	/* JIRA Worklog => x_snc_ippy_jira_worklogs *********************************************************

		webhookEvent = ['jira:worklog_updated', 'worklog_deleted']

		Notes:
			- Using jira:worklog_updated event to relate worklog to issue
			- 'worklog' data structure implies maxResult = 20, meaning likely only see recent 20 worklogs,
				should be fine for POC logic
	***************************************************************************************************** */

	update_worklog: function() {

		issueId		= this.data.issue.id;
		issueUrl	= this.data.issue.self;
		issueKey	= this.data.issue.key;
		
		worklog 	= this.data.issue.fields.worklog;

		// Iterate worklogs
		for (var i=0; i<worklog.worklogs.length; i++) {
			thisLog = worklog.worklogs[i];

			var url 	= thisLog.self;
			var id 		= thisLog.id;
			var comment = thisLog.comment;
			var created = thisLog.created;
			var updated = thisLog.updated;
			var started = thisLog.started;
			var timeSpent = thisLog.timeSpent;
			var timeSpentSeconds = thisLog.timeSpentSeconds;
			
			var authorSysId	= this.get_sn_user(thisLog.author.emailAddress);
			var issueSysId	= this.get_sn_jira_record(issueUrl, 'x_snc_ippy_jira_issues');
			var updateAuthorSysId = this.get_sn_user(thisLog.updateAuthor.emailAddress);

			rec = new GlideRecord('x_snc_ippy_jira_worklogs');
			rec.addQuery('url', url);
			rec.query();
			rec.next();

			rec.url 	= url;
			rec.id 		= id;
			rec.comment	= comment;
			rec.created = this.ISODateTimeToGlideDateTime(created);
			rec.updated = this.ISODateTimeToGlideDateTime(updated);
			rec.started = this.ISODateTimeToGlideDateTime(started);
			rec.issue 	= issueSysId;
			rec.author 	= authorSysId;
			rec.update_author 	= updateAuthorSysId;
			rec.time_spent 		= timeSpent;
			rec.time_spent_secs = timeSpentSeconds;
			rec.update();
		}

		return;
	},

	delete_worklog: function() {
		
		id		= this.data.worklog.id;
		url 	= this.data.worklog.self;

		rec = new GlideRecord('x_snc_ippy_jira_worklogs');
		rec.addQuery('url', url);
		rec.deleteMultiple();

		return;
	},

	get_sn_user: function(email) {

		if (gs.nil(email)) {
			return null;
		}
		
		user = new GlideRecord('sys_user');
		user.addQuery('email', email);
		user.query();

		if (user.next()) {
			return user.sys_id;
		} else {
			return null;
		}
	},

	get_uri_host: function(uri) {
		
		hostname = null;
		if (!gs.nil(uri)) {
			matches  = uri.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i);
			hostname = matches && matches[1];
		}
		return hostname;
	},

	get_sn_project: function(uri) {

		rec = new GlideRecord('x_snc_ippy_jira_projects');
		rec.addQuery('url', uri);
		rec.query();

		if (rec.next()) {
			return rec.sys_id;
		} else {
			return null;
		}
	},

	get_sn_jira_record: function(uri, table) {

		rec = new GlideRecord(table);
		rec.addQuery('url', uri);
		rec.query();

		if (rec.next()) {
			return rec.sys_id;
		} else {
			return null;
		}
	},


	get_sn_sprint: function(id, boardId) {

		rec = new GlideRecord('x_snc_ippy_jira_sprints');
		rec.addQuery('id', id);
		rec.addQuery('boardid', boardId);
		rec.query();

		if (rec.next()) {
			return rec.sys_id;
		} else {
			return null;
		}
	},

	patch_project_sprint: function(projectSysId, sprintSysId) {

		rec = new GlideRecord('x_snc_ippy_jira_sprints');
		if (rec.get(sprintSysId)) {
			rec.project = projectSysId;
			rec.update();
		} else {
			gs.error("Unable to locate record '" + sprintSysId + "' in x_snc_ippy_jira_sprints");
		}

		return;
	},

	/* function : ISODateTimeToGlideDateTime()
		Convert ISO8601 DateTime string to GlideDateTime object
	*/
	ISODateTimeToGlideDateTime: function(s) {
		if ( (s == '') || (s == null) ) {
			return null;
		}

	    // GlideDateTime constructor expects date format: 'YY-MM-DD HH::MM::SS'
	    parts = s.split(/[-TZ:+]/g);
	    
	    if (parts.length < 6) {
	    	return null;
	    }

	    dts = '';
		dts += parts[0] + "-" + parts[1] + "-" + parts[2];
		dts += ' ';

		// Handle sub seconds
		sec = parts[5].split(/\./);
		dts += parts[3] + ":" + parts[4] + ":" + sec[0];
		
		// Calculate timezone offset in seconds
		sign = /\d\d-\d\d:\d\d$/.test(s)? '-' : '+';
		if ( (parts[6] != null) && (parts[7] != null) ) {
			offset = parseInt(parts[6] * 3600 + parseInt(parts[7] * 60));
			offset = 0 + (sign == '-' ? -1 * offset : offset);
		} else {
			offset = 0;
		}
		
		// GlideDateTime object
		gdt = new GlideDateTime(dts);
		gdt.addSeconds(offset);
		
		return gdt;
	},

    type: 'JiraWebhookProcessor'
});
