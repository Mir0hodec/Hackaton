package ai.naryad.lan;
import android.content.*;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;
/** Scoped URI grant lets the system camera save one image without storage/camera permissions. */
public final class CaptureProvider extends ContentProvider {
 public boolean onCreate(){return true;}
 private File file(Uri uri) throws FileNotFoundException {
  String name=uri.getLastPathSegment();
  if(name==null || !name.matches("capture-[0-9]+\\.jpg"))throw new FileNotFoundException();
  return new File(getContext().getCacheDir(),name);
 }
 public String getType(Uri uri){return "image/jpeg";}
 public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException {
  return ParcelFileDescriptor.open(file(uri),ParcelFileDescriptor.parseMode(mode));
 }
 public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){
  try{File f=file(uri);String[] cols=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;MatrixCursor c=new MatrixCursor(cols);Object[] values=new Object[cols.length];for(int i=0;i<cols.length;i++)values[i]=OpenableColumns.DISPLAY_NAME.equals(cols[i])?f.getName():OpenableColumns.SIZE.equals(cols[i])?f.length():null;c.addRow(values);return c;}catch(FileNotFoundException e){return null;}
 }
 public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
 public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
 public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
