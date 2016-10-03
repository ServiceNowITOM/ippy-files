var GitHubWebHookProcessor = Class.create();
GitHubWebHookProcessor.prototype = Object.extendsObject(WebhookProcessor,{
	
	Check_Test: function(requestdata){
	if (requestdata.zen){
		return true
		}
	
	},
	
	Get_Files: function(url, user, password){
		var restMessage = new sn_ws.RESTMessageV2();
		restMessage.setBasicAuth(user, password);
		restMessage.setHttpMethod("get");
		var myurl = url.replace(/https:\/\/.*?\//, "https://api.github.com/");
		myurl = myurl.replace("commit", "commits");
		myurl = myurl.replace('.com/', '.com/repos/');
		restMessage.setEndpoint(myurl);
		var httpExecute = restMessage.execute();
		if (httpExecute.getStatusCode() != 200){
			throw httpExecute.getErrorMessage();
			gs.info("url error:" + httpExecute.getErrorMessage());
		}
		var messageBody = httpExecute.getBody();
		var webReturn = global.JSON.parse(messageBody);
		return webReturn.files;
	},
	
	Get_Commit_JSON: function(url, user, password){
		var restMessage = new sn_ws.RESTMessageV2();
		restMessage.setBasicAuth(user, password);
		restMessage.setHttpMethod("get");
		var myurl = url.replace(/https:\/\/.*?\//, "https://api.github.com/");
		myurl = myurl.replace("commit", "commits");
		myurl = myurl.replace('.com/', '.com/repos/');
		restMessage.setEndpoint(myurl);
		var httpExecute = restMessage.execute();
		if (httpExecute.getStatusCode() != 200){
			throw httpExecute.getErrorMessage();
			gs.info("url error:" + httpExecute.getErrorMessage());
		}
		var messageBody = httpExecute.getBody();
		var webReturn = global.JSON.parse(messageBody);
		return webReturn;
	},
	
	Repo_FullName: function(FullName){
		var refsplit = FullName.split("/");
		return {
			reponame: refsplit[0],
			ownername: refsplit[1]
		};
		
	},
	
	Get_Branch: function(ref, repoID){
		var refsplit = ref.split("/");
		var workingBranchName = refsplit[2];
		var branchname;
		var branchDB = new GlideRecord('x_snc_ippy_github_scm_branches');
		branchDB.addQuery('name' ,workingBranchName);
		branchDB.addQuery('repository', repoID);
		branchDB.query();
		while (branchDB.next()) {
			branchname = branchDB.name;
			var BranchID = branchDB.sys_id;
		}
		if (!branchname){
			var branchDB_add = new GlideRecord('x_snc_ippy_github_scm_branches');
			branchDB_add.initialize(); 
			branchDB_add.name = workingBranchName; 
			branchDB_add.repository = repoID;
			var BranchID = branchDB_add.insert();
		}
		return BranchID;
	},
	
	Write_Files: function(Files, CommitID, owner, reponame, SHA, user, password){
		//Loop through all files in a commit
		for (ib = 0; ib < Files.length; ib++) {
			var raw_filename = Files[ib].filename;
			var fileurl = encodeURI(raw_filename);
			try {
				var rawfile = new sn_ws.RESTMessageV2();
				rawfile.setEndpoint('https://raw.githubusercontent.com/' + owner + "/" + reponame + "/" + SHA + "/" + fileurl);			
				rawfile.setBasicAuth(user, password);
				rawfile.setHttpMethod("get");
				var response = rawfile.execute();
				var responseBody = response.getBody();
				var httpStatus = response.getStatusCode();
			}
			catch(ex) {
				throw response.getErrorMessage();
				gs.info(ex);
			}
			//Write the file details to a DB
			var repo_commits_file = new GlideRecord('x_snc_ippy_github_commit_files');
			repo_commits_file.initialize();
			repo_commits_file.commit_sha = Files[ib].sha;
			repo_commits_file.file_id = Files[ib].sha;
			repo_commits_file.file_name = Files[ib].filename;
			repo_commits_file.file_changes = Files[ib].patch;
			repo_commits_file.patch = Files[ib].patch;
			repo_commits_file.file_additions = Files[ib].additions;
			repo_commits_file.file_deletions = Files[ib].deletions;
			repo_commits_file.file_changes_count = Files[ib].changes;
			repo_commits_file.commit = CommitID;
			repo_commits_file.status = Files[ib].status;
			repo_commits_file.total_file_changes = Files[ib].changes;
			repo_commits_file.insert();
		}
	},
	Write_Commits: function(commits_return_json, repo_sysID, branch_sysID){

		var repo_commits = new GlideRecord('x_snc_ippy_github_scm_commits');
		repo_commits.initialize();
		repo_commits.branch = branch_sysID;
		repo_commits.commit_id = commits_return_json.sha;
		repo_commits.change_additions = commits_return_json.stats.additions;
		repo_commits.change_deletions = commits_return_json.stats.deletions;
		repo_commits.commit_date = this.ISODateTimeToGlideDateTime(commits_return_json.commit.author.date);
		repo_commits.commiter = commits_return_json.commit.committer.name;
		repo_commits.repository = repo_sysID;
		repo_commits.message = commits_return_json.commit.message;
		repo_commits.sha = commits_return_json.sha;
		repo_commits.user = this.Get_User(commits_return_json.commit.committer.email);
		repo_commits.total_changes = commits_return_json.stats.total;
		repo_commits.url = commits_return_json.url;
		var commit_id = repo_commits.insert();
		return commit_id;
	},
	
	Check_Commit: function(sha){
		var branch_CommitsDB = new GlideRecord('x_snc_ippy_github_scm_commits');
		branch_CommitsDB.addQuery('sha', sha);
		branch_CommitsDB.query();
		var branch_commits_InDB;
		while (branch_CommitsDB.next()) {
			return branch_CommitsDB.sha;
		}
	},
	
	RelateStory: function(commitID){
		var mycommit = new GlideRecord('x_snc_ippy_github_scm_commits');
		mycommit.get(commitID);
		var myMessage = mycommit.message;
		var messagesplit = myMessage.split(" ");
		for (x = 0; x < messagesplit.length; x++) {
			var mystory = new GlideRecord('rm_story');
			mystory.addQuery('number', messagesplit[x]);
			mystory.query();
			while (mystory.next()) {
				if (mystory.sys_id){
					mycommit.storytwo = mystory.sys_id;
					mycommit.update();
				}
			}
		}
	},
	
	RelateIssue: function(commitID){
		var mycommit = new GlideRecord('x_snc_ippy_github_scm_commits');
		mycommit.get(commitID);
		var myMessage = mycommit.message;
		var messagesplit = myMessage.split(" ");
		for (x = 0; x < messagesplit.length; x++) {
			var mystory = new GlideRecord('x_snc_ippy_jira_issues');
			mystory.addQuery('key', messagesplit[x]);
			mystory.query();
			while (mystory.next()) {
				if (mystory.sys_id){
					mycommit.story = mystory.sys_id;
					mycommit.update();
				}
			}
		}
	},
	
	Get_User: function(email){
		var gr = new GlideRecord('sys_user');
		gr.addQuery('email', email);
		gr.query();
		var userSysID;
		while (gr.next()){
			userSysID = gr.sys_id;
		}
		return userSysID;
	},
	
	Get_Repository_and_Cred: function(url){
		var juser;
		var jpass;
		var myurl = url + ".git";
		var GL = new GlideRecord('x_snc_ippy_github_scm_repositories');
		GL.addQuery('url' ,myurl);
		GL.query();
		while (GL.next()) {
			juser = GL.credential.user;
			var pass = GL.credential.password;
			jpass = GL.credential.password.getDecryptedValue();
			return {
				user: juser,
				password: jpass,
				repoSysID: GL.sys_id
			};

		}
	},
	
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
		dts += parts[3] + ":" + parts[4] + ":" + parts[5];
	
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
	
	process: function(){
	
	if (this.Check_Test(this.data)){
		return "Test";
	}
		//Set ScratchPad Value
	var myCommitJSON = this.data;

	//Get Repo information from the Commit
	var repoinfo = this.Get_Repository_and_Cred(myCommitJSON.repository.url);

	//Get Repo Owner Name and Repo Name
	var full_name = this.Repo_FullName(myCommitJSON.repository.full_name);

	//Get Branch Info
	var branch = this.Get_Branch(myCommitJSON.ref, repoinfo.repoSysID);

	//See if Current Commit is in the System
	var branch_commits_InDB = this.Check_Commit(myCommitJSON.sha);

	//If Commit is not in the system Write it to the System
	if (!branch_commits_InDB){

	
	//Setting some values to make life easy
		var user = repoinfo.user;
		var password = repoinfo.password;
		var SHA = myCommitJSON.commits[0].id;
		var reponame = full_name.reponame;
		var owner = full_name.ownername;
		var files = this.Get_Files(myCommitJSON.commits[0].url, user, password);
	//Get Detailed Commit
		var commits_return_json = this.Get_Commit_JSON(myCommitJSON.commits[0].url, user, password);

	//Write Commit to Commit Table and return SysID of the Commit
		var Commit_sysID = this.Write_Commits(commits_return_json, repoinfo.repoSysID, branch);


	//Write Files to table
		this.Write_Files(files, Commit_sysID, owner, reponame, SHA);
		
	//Relate Story if needed
		this.RelateStory(Commit_sysID);
		this.RelateIssue(Commit_sysID);
	
	}	
	},

    type: 'GitHubWebHookProcessor'
});