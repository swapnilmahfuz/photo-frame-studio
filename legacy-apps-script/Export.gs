// Optional one-time export from the old project. Run from the editor as its owner.
function exportLegacyCampaigns() {
  owner_();
  const output = DriveApp.createFolder('Photo Frame Studio migration export');
  const frames = rows_(table_('Frames')).map(item => item.data);
  for (const {data:campaign} of rows_(table_('Campaigns'))) {
    const entries = sorted_(frames.filter(frame => frame.campaign === campaign.id && !frame.deleted));
    const data = {
      slug:campaign.slug,title:campaign.title,description:campaign.description,
      status:campaign.status,defaultId:campaign.defaultId,
      frames:entries.map(({id,name,enabled,count,file}) => {
        const png = DriveApp.getFileById(file).getBlob();
        return {id,name,enabled,count,image:'data:image/png;base64,'+Utilities.base64Encode(png.getBytes())};
      })
    };
    output.createFile(Utilities.newBlob(JSON.stringify(data),'application/json',campaign.slug+'.json'));
  }
  console.log('Private export folder: ' + output.getUrl());
}
